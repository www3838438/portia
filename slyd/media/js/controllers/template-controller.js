ASTool.MappedFieldData = Em.Object.extend({
	fieldName: null,
	extractors: [],
	required: false,
	extracted: false,
	disabled: true,
}),


ASTool.TemplateIndexController = Em.ObjectController.extend(ASTool.BaseControllerMixin,
	ASTool.DocumentViewDataSource, ASTool.DocumentViewListener, {

	needs: ['application', 'items', 'spider_index', 'spider'],

	navigationLabelBinding: 'content.name',

	annotations: [],

	items: [],

	extractors: [],

	annotationsLoaded: false,

	showContinueBrowsing: true,

	showToggleCSS: true,

	showFloatingAnnotationWidgetAt: null,

	floatingAnnotation: null,

	scrapedItem: function() {
		if (!Em.isEmpty(this.get('items'))) {
			return this.get('items').findBy('name', this.get('content.scrapes'));
		} else {
			return null;
		}
	}.property('content.scrapes', 'items.@each'),

	documentView: null,

	currentlySelectedElement: null,

	newReExtractor: null,

	_newTypeExtractor: 'null',

	newTypeExtractor: function(key, type) {
		if (arguments.length > 1) {
			this.set('_newTypeExtractor', type);
			if (type) {
				this.set('newReExtractor', null);
			}
		}
		return this.get('_newTypeExtractor');
	}.property('_newTypeExtractor'),

	createExtractorDisabled: function() {
		return !this.get('newTypeExtractor') && !this.get('newReExtractor');
	}.property('newReExtractor', 'newTypeExtractor'),

	sprites: function() {
		return this.get('annotations').map(function(annotation) {
			if (annotation.get('element')) {
				return ASTool.AnnotationSprite.create({'annotation': annotation});
			} else {
				return null;
			}
		}).filter(function(sprite) { return !!sprite; });
	}.property('annotations.@each.element', 'annotations.@each.highlighted'),

	addAnnotation: function(element, generated) {
		var annotation = ASTool.Annotation.create({
			id: ASTool.shortGuid(),
			selectedElement: element,
			generated: !!generated,
		});
		this.get('annotations').unshiftObject(annotation);
		return annotation;
	},

	mapAttribute: function(annotation, attribute, field) {
		annotation.removeMappings();
		annotation.addMapping(attribute, field);
	},

	makeSticky: function(annotation, attributeName) {
		var maxSticky = this.get('maxSticky');
		var stickyName = '_sticky' + (maxSticky + 1);
		annotation.addMapping(attributeName, stickyName);
		annotation.addRequired(stickyName);
	},

	editAnnotation: function(annotation) {
		annotation.set('highlighted', false);
		this.saveAnnotations();
		this.transitionToRoute('annotation', annotation);
	},

	deleteAnnotation: function(annotation) {
		if (annotation.get('generated')) {
			$(annotation.get('element')).removePartialAnnotation();
		}
		this.set('floatingAnnotation', null);
		this.set('showFloatingAnnotationWidgetAt', null);
		this.get('annotations').removeObject(annotation);
		this.set('content.extractors', this.validateExtractors());
	},

	saveAnnotations: function() {
		this.get('annotationsStore').saveAll(this.get('annotations'));
		if (this.get('content')) {
			this.set('content.annotated_body', this.get('documentView').getAnnotatedDocument());
			this.set('content.annotations', this.get('documentView').getAnnotations());
			this.set('content.extractors', this.validateExtractors());
		}
	},

	saveTemplate: function() {
		this.saveAnnotations();
		missing_fields = this.missingRequiredAnnotations();
		if (missing_fields.length > 0) {
			this.showAlert('Save Error',
				'Can\'t save template as the following required fields are missing: "' + missing_fields.join('", "') + '".');
			return;
		}
		return this.get('slyd').saveTemplate(
			this.get('controllers.spider.name'), this.get('content'));
	},

	saveExtractors: function() {
		// Cleanup extractor objects.
		this.get('extractors').forEach(function(extractor) {
			delete extractor['dragging'];
		});
		this.get('slyd').saveExtractors(this.get('extractors'));
	},

	validateExtractors: function() {
		var annotations = this.get('annotations'),
			extractors = this.get('extractors'),
			template_ext = this.get('content.extractors'),
			new_extractors = {},
			extractor_ids = {};
		extractors.forEach(function(extractor) {
			extractor_ids[extractor.id] = true;
		});
		annotations.forEach(function(annotation) {
			annotation.get('mappedAttributes').forEach(function(mapping) {
				var field = mapping.mappedField,
					item_extractors = template_ext[field];
				if (item_extractors instanceof Array) {
					item_extractors.forEach(function(extractor_id) {
						if (extractor_ids[extractor_id]) {
							new_extractors[field] = new_extractors[field] || [];
							new_extractors[field].push(extractor_id);
						}
					});
				}
			});
		});
		return new_extractors;
	},

	maxVariant: function() {
		var maxVariant = 0;
		this.get('annotations').forEach(function(annotation) {
			var stringVariant = annotation.get('variant');
			var variant = stringVariant ? parseInt(stringVariant) : 0;
			maxVariant = variant > maxVariant ? variant : maxVariant;
		});
		return maxVariant;
	}.property('annotations.@each.variant'),

	maxSticky: function() {
		var maxSticky = 0;
		this.get('annotations').forEach(function(annotation) {
			annotation.get('stickyAttributes').forEach(function(stickyAttribute) {
				var sticky = parseInt(
					stickyAttribute.get('mappedField').substring('_sticky'.length));
				if (sticky > maxSticky) {
					maxSticky = sticky;
				}
			});
		});
		return maxSticky;
	}.property('annotations.@each.stickyAttributes.@each'),

	getAppliedExtractors: function(fieldName) {
		var extractorIds = this.get('content.extractors.' + fieldName) || [];
		return extractorIds.map(function(extractorId) {
				var extractor = this.get('extractors').filterBy('name', extractorId)[0];
				if (extractor) {
					extractor = extractor.copy();
					extractor['fieldName'] = fieldName;
					return extractor;
				} else {
					return null;
				}
			}.bind(this)
		).filter(function(extractor){ return !!extractor; });
	},

	mappedFieldsData: function() {
		var mappedFieldsData = [];
		var seenFields = new Set();
		var item_required_fields = new Set();
		var scraped_item = this.get('scrapedItem');
		var annotations = this.get('annotations');
		if (scraped_item) {
			scraped_item.fields.forEach(function(field) {
				if (field.required) item_required_fields.add(field.name);
			});
		}
		if (annotations) {
			this.get('annotations').forEach(function(annotation) {
				var mappedAttributes = annotation.get('mappedAttributes');
				mappedAttributes.forEach(function(attribute) {
					var fieldName = attribute.get('mappedField');
					// Avoid duplicates.
					if (!seenFields.has(fieldName)) {
						seenFields.add(fieldName);
						var mappedFieldData = ASTool.MappedFieldData.create();
						mappedFieldData.set('fieldName', fieldName);
						mappedFieldData.set('required', annotation.get('required').indexOf(fieldName) > -1);
						mappedFieldData.set('extractors', this.getAppliedExtractors(fieldName));
						mappedFieldData.set('extracted', true);
						mappedFieldData.set('disabled', item_required_fields.has(fieldName));
						mappedFieldsData.pushObject(mappedFieldData);
					}
				}.bind(this));
			}.bind(this));
		}
		if (scraped_item) {
			this.get('scrapedItem').fields.forEach(function(field) {
				fieldName = field.name;
				if (!seenFields.has(fieldName)) {
					var mappedFieldData = ASTool.MappedFieldData.create();
					mappedFieldData.set('fieldName', fieldName);
					mappedFieldData.set('required', field.required);
					mappedFieldsData.pushObject(mappedFieldData);
				}
			});
		}
		return mappedFieldsData;
	}.property('annotations.@each.mappedAttributes',
			   'content.extractors',
			   'extractors.@each'),

	missingRequiredAnnotations: function() {
		var required = [];
		this.get('mappedFieldsData').forEach(function(field) {
			if (field.required && !field.extracted)
				required.push(field.fieldName);
		});
		return required;
	},

	annotationsMappingField: function(fieldName) {
		var annotations = new Em.Set();
		this.get('annotations').forEach(function(annotation) {
			var mappedAttributes = annotation.get('mappedAttributes');
			mappedAttributes.forEach(function(attribute) {
				if (attribute.get('mappedField') == fieldName) {
					annotations.add(annotation);
				}
			}.bind(this));
		}.bind(this));
		return annotations;
	},

	createExtractor: function(extractorType, extractorDefinition) {
		var extractor = ASTool.Extractor.create({
			name: ASTool.shortGuid(),
		});
		if (extractorType === 'regular_expression') {
			try {
				new RegExp(extractorDefinition);
			} catch (e) {
				if (e instanceof SyntaxError) {
					this.showAlert('Save Error','The text, "' + extractorDefinition + '", you provided is not a valid regex.');
				}
				return;
			}
		}
		extractor.set(extractorType, extractorDefinition);
		this.get('extractors').pushObject(extractor);
	},

	draggingExtractor: function() {
		return this.get('extractors').anyBy('dragging');
	}.property('extractors.@each.dragging'),

	showFloatingAnnotationWidget: function(annotation, x, y) {
		this.set('floatingAnnotation', annotation);
		if (x < 200) {
			x = 100;
		}
		if (x > window.innerWidth - 250) {
			x = window.innerWidth - 250;
		}
		if (y > window.innerHeight - 160) {
			y = window.innerHeight - 160;
		}
		this.set('showFloatingAnnotationWidgetAt', { x: x, y: y });
	},

	hideFloatingAnnotationWidget: function() {
		this.set('floatingAnnotation', null);
		this.set('showFloatingAnnotationWidgetAt', null);
	},

	emptyAnnotations: function() {
		return this.get('annotations').filter(function(annotation) {
			return Em.isEmpty(annotation.get('mappedAttributes')) &&
				Em.isEmpty(annotation.get('stickyAttributes'));
		});
	}.observes('annotations.@each.mappedAttributes'),

	checkAnnotations: function() {
		if (this.get('annotationsLoaded')) {
			this.get('documentView').config(
				{ mode: 'select',
				  listener: this,
				  dataSource: this,
				  partialSelects: true });
		}
	}.observes('annotationsLoaded'),

	actions: {

		editAnnotation: function(annotation) {
			this.editAnnotation(annotation);
		},

		mapAttribute: function(annotation, attribute, field) {
			this.mapAttribute(annotation, attribute, field);
		},

		makeSticky: function(annotation, attribute) {
			this.makeSticky(annotation, attribute);
		},

		deleteAnnotation: function(annotation) {
			this.deleteAnnotation(annotation);
		},

		createField: function(fieldName, fieldType) {
			this.get('controllers.items').addField(this.get('scrapedItem'), fieldName, fieldType);
			this.get('slyd').saveItems(this.get('items').toArray()).then(function() { },
				function(reason) {
					this.showHTTPAlert('Save Error', reason);
				}.bind(this)
			);
		},

		annotationHighlighted: function(annotation) {
			if (annotation.get('element')) {
				this.get('documentView').scrollToElement(annotation.get('element'));
			}
		},

		rename: function(oldName, newName) {
			this.set('name', oldName);
			saveFuture = this.saveTemplate()
			if (!saveFuture) return;
			saveFuture.then(function() {
				var templateNames = this.get('controllers.spider.content.template_names');
				newName = this.getUnusedName(newName, templateNames);
				var spiderName = this.get('controllers.spider.name');
				this.get('slyd').renameTemplate(spiderName, oldName, newName).then(
					function() {
						templateNames.removeObject(oldName);
						templateNames.addObject(newName);
						this.replaceRoute('template', newName);
					}.bind(this),
					function(reason) {
						this.showHTTPAlert('Save Error', 'The name ' + newName + ' is not a valid template name.');
					}.bind(this)
				);
			}.bind(this));
		},

		createExtractor: function() {
			if (this.get('newReExtractor')) {
				this.createExtractor('regular_expression', this.get('newReExtractor'));
				this.set('newReExtractor', null);
			} else if (this.get('newTypeExtractor')) {
				this.createExtractor('type_extractor', this.get('newTypeExtractor'));
			}
			this.saveExtractors();
		},

		deleteExtractor: function(extractor) {
			// Remove all references to this extractor.
			Object.keys(this.get('content.extractors')).forEach(function(fieldName) {
				this.get('content.extractors')[fieldName].removeObject(extractor['name']);
			}.bind(this));
			this.get('extractors').removeObject(extractor);
			this.saveExtractors();
		},

		applyExtractor: function(fieldName, extractorId) {
			var currentExtractors = this.get('content.extractors')[fieldName];
			if (!currentExtractors) {
				currentExtractors = [];
				this.set('content.extractors.' + fieldName, currentExtractors);
			}
			if (currentExtractors.indexOf(extractorId) == -1) {
				currentExtractors.pushObject(extractorId);
				this.notifyPropertyChange('content.extractors');
			}
		},

		removeAppliedExtractor: function(appliedExtractor) {
			// TODO: we need to automatically remove extractors when the field they
			// extract is no longer mapped from any annotation.
			var fieldName = appliedExtractor['fieldName'];
			this.get('content.extractors')[fieldName].removeObject(appliedExtractor['name']);
			this.notifyPropertyChange('content.extractors');
		},

		setRequired: function(fieldName, required) {
			var annotations = this.annotationsMappingField(fieldName);
			annotations.forEach(function(annotation) {
				if (required) {
					annotation.addRequired(fieldName);
				} else {
					annotation.removeRequired(fieldName);
				}
			});
		},

		editItems: function() {
			this.saveAnnotations();
			this.transitionToRoute('items');
		},

		continueBrowsing: function() {
			this.emptyAnnotations().forEach(function(annotation) {
				this.deleteAnnotation(annotation);
			}.bind(this));
			saveFuture = this.saveTemplate()
			if (!saveFuture) return;
			saveFuture.then(function() {
				this.set('controllers.spider_index.autoloadTemplate', this.get('url'));
				this.transitionToRoute('spider');
			}.bind(this),
			function(reason) {
				this.showHTTPAlert('Save Error', reason);
			}.bind(this));
		},

		hideFloatingAnnotationWidget: function() {
			this.hideFloatingAnnotationWidget();
		},

		selected: function() {
			console.log('Selected!');
		},

		toggleCSS: function() {
			//FIXME: Set state correctly
			button = $('.togglecss');
			if (button.hasClass('btn-default')) {
				button.addClass('btn-danger');
				button.removeClass('btn-default');
			} else {
				button.removeClass('btn-danger');
				button.addClass('btn-default');
			}
			this.documentView.toggleCSS();
		},
	},

	documentActions: {

		elementSelected: function(element, mouseX, mouseY) {
			if (element) {
				var annotation = this.get('annotations').findBy('element', element);
				if (!annotation) {
					annotation = this.addAnnotation(element);
				}
				this.showFloatingAnnotationWidget(annotation, mouseX, mouseY);
			}
		},

		partialSelection: function(selection, mouseX, mouseY) {
			var element = $('<ins/>').get(0);
			selection.getRangeAt(0).surroundContents(element);
			this.showFloatingAnnotationWidget(this.addAnnotation(element, true), mouseX, mouseY);
			selection.collapse();
		},

		elementHovered: function(element, mouseX, mouseY) {
			this.get('annotations').forEach(function(annotation){
				annotation.set('highlighted', false);
			});
			var annotation = this.get('annotations').findBy('element', element);
			if (annotation) {
				annotation.set('highlighted', true);
			} else {
				this.hideFloatingAnnotationWidget();
			}
			this.get('documentView').redrawNow();
		},
	},

	willEnter: function() {
		if (this.get('annotationsLoaded')) {
			this.get('documentView').config({ mode: 'select',
					  listener: this,
					  dataSource: this,
					  partialSelects: true });
		}
	},

	willLeave: function() {
		this.hideFloatingAnnotationWidget();
	}
});
