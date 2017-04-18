var _ = require('underscore');
var $ = require('jquery');
var CoreView = require('backbone/core-view');
var template = require('./data-layer.tpl');
var ContextMenuView = require('../../../components/context-menu/context-menu-view');
var CustomListCollection = require('../../../components/custom-list/custom-list-collection');
var renameLayer = require('../operations/rename-layer');
var DeleteLayerConfirmationView = require('../../../components/modals/remove-layer/delete-layer-confirmation-view');
var ModalExportDataView = require('../../../components/modals/export-data/modal-export-data-view');
var InlineEditorView = require('../../../components/inline-editor/inline-editor-view');
var TipsyTooltipView = require('../../../components/tipsy-tooltip-view');
var zoomToData = require('../../map-operations/zoom-to-data');
var templateInlineEditor = require('./inline-editor.tpl');
var geometryNoneTemplate = require('./geometry-none.tpl');
var geometryPointsTemplate = require('./geometry-points.tpl');
var geometryLinesTemplate = require('./geometry-lines.tpl');
var geometryPolygonsTemplate = require('./geometry-polygons.tpl');
var checkAndBuildOpts = require('../../../helpers/required-opts');

var REQUIRED_OPTS = [
  'userActions',
  'stackLayoutModel',
  'layerDefinitionsCollection',
  'modals',
  'configModel',
  'stateDefinitionModel',
  'widgetDefinitionsCollection',
  'visDefinitionModel',
  'analysisDefinitionNodesCollection'
];

module.exports = CoreView.extend({

  tagName: 'li',
  className: 'Editor-ListLayer-item js-layer',

  events: {
    'click': '_onEditLayer',
    'click .js-base': '_onClickSource',
    'click .js-title': '_onClickTitle',
    'click .js-toggle-menu': '_onToggleContextMenuClicked',
    'click .js-toggle': '_onToggleLayerClicked',
    'click .js-analysis-node': '_onAnalysisNodeClicked'
  },

  initialize: function (opts) {
    checkAndBuildOpts(opts, REQUIRED_OPTS, this);

    if (!_.isFunction(opts.newAnalysesView)) throw new Error('newAnalysesView is required as a function');

    this._newAnalysesView = opts.newAnalysesView;
    this._styleModel = this.model.styleModel;

    var nodeDefModel = this.model.getAnalysisDefinitionNodeModel();

    this._queryGeometryModel = nodeDefModel.queryGeometryModel;

    this._bindEvents();

    if (this._queryGeometryModel.shouldFetch()) {
      this._queryGeometryModel.fetch();
    }
  },

  render: function () {
    this.clearSubViews();

    var m = this.model;
    var self = this;
    var isTorque = m.isTorqueLayer();
    var isAnimation = this._styleModel.isAnimation();
    var geometryTemplate = this._getGeometryTemplate(this._queryGeometryModel.get('simple_geom'));

    this.$el.html(template({
      layerId: m.id,
      title: m.getName(),
      color: m.get('color'),
      isVisible: m.get('visible'),
      isAnimated: isAnimation,
      isTorque: isTorque,
      hasError: this._hasError(),
      isCollapsed: this._isCollapsed(),
      numberOfAnalyses: m.getNumberOfAnalyses(),
      numberOfWidgets: this._widgetDefinitionsCollection.widgetsOwnedByLayer(m.id),
      hasGeom: this._queryGeometryHasGeom()
    }));

    this._inlineEditor = new InlineEditorView({
      template: templateInlineEditor,
      renderOptions: {
        title: m.getName()
      },
      onClick: self._onEditLayer.bind(self),
      onEdit: self._renameLayer.bind(self)
    });
    this.addView(this._inlineEditor);

    this.$('.js-thumbnail').append(geometryTemplate({
      letter: m.get('letter')
    }));
    this.$('.js-header').append(this._inlineEditor.render().el);

    this.$el.toggleClass('is-unavailable', m.isNew());
    this.$el.toggleClass('js-sortable-item', !isTorque);
    this.$el.toggleClass('is-animated', isTorque);
    this.$('.js-thumbnail').toggleClass('is-hidden', this._isHidden());
    this.$('.js-title').toggleClass('is-hidden', this._isHidden());
    this.$('.js-analyses-widgets-info').toggleClass('is-hidden', this._isHidden());

    if (isTorque) {
      var torqueTooltip = new TipsyTooltipView({
        el: this.$('.js-torqueIcon'),
        gravity: 's',
        offset: 0,
        title: function () {
          return $(this).data('tooltip');
        }
      });
      this.addView(torqueTooltip);
    }

    if (!this._queryGeometryHasGeom()) {
      var georeferenceTooltip = new TipsyTooltipView({
        el: this.$('.js-georeferenceIcon'),
        gravity: 's',
        offset: 0,
        title: function () {
          return $(this).data('tooltip');
        }
      });
      this.addView(georeferenceTooltip);
    }

    this._toggleClickEventsOnCapturePhase('remove'); // remove any if rendered previously
    if (m.isNew()) {
      this._toggleClickEventsOnCapturePhase('add');
    }

    if (m.get('source')) {
      var analysesView = this._newAnalysesView(this.$('.js-analyses'), m);
      this.addView(analysesView);
      analysesView.render();
    }

    if (this._hasError()) {
      var errorTooltip = new TipsyTooltipView({
        el: this.$('.js-error'),
        gravity: 's',
        offset: 0,
        title: function () {
          return this.model.get('error') && this.model.get('error').message;
        }.bind(this)
      });
      this.addView(errorTooltip);
    }

    return this;
  },

  _bindEvents: function () {
    this.listenTo(this.model, 'change', this.render);
    this.listenToOnce(this.model, 'destroy', this._onDestroy);
    this.listenTo(this.model, 'change:collapsed', this.render);
    this.listenTo(this._queryGeometryModel, 'change:simple_geom', this.render);
  },

  _getGeometryTemplate: function (geometry) {
    switch (geometry) {
      case 'line':
        return geometryLinesTemplate;
      case 'point':
        return geometryPointsTemplate;
      case 'polygon':
        return geometryPolygonsTemplate;
      default:
        return geometryNoneTemplate;
    }
  },

  _isHidden: function () {
    return !this.model.get('visible');
  },

  _hasError: function () {
    return !!this.model.get('error');
  },

  _isCollapsed: function () {
    return !!this.model.get('collapsed');
  },

  _onClickTitle: function (event) {
    // event is handled with inlineEditor
    event.stopPropagation();
  },

  _onAnalysisNodeClicked: function (event) {
    event.stopPropagation();

    var nodeId = event.currentTarget && event.currentTarget.dataset.analysisNodeId;
    if (!nodeId) throw new Error('missing data-analysis-node-id on element to edit analysis node, the element was: ' + event.currentTarget.outerHTML);

    var nodeDefModel = this._analysisDefinitionNodesCollection.get(nodeId);
    var layerDefModel = this._layerDefinitionsCollection.findOwnerOfAnalysisNode(nodeDefModel);
    if (!layerDefModel) throw new Error('no owning layer found for node ' + nodeId);

    this._stackLayoutModel.nextStep(layerDefModel, 'layer-content', 'analyses', nodeId);
  },

  _onClickSource: function (event) {
    event.stopPropagation();

    this._stackLayoutModel.nextStep(this.model, 'layer-content');
  },

  _onEditLayer: function (event) {
    event && event.stopPropagation();

    this._stackLayoutModel.nextStep(this.model, 'layer-content', 'style');
  },

  _onToggleCollapsedLayer: function () {
    this.model.toggleCollapse();
  },

  _onToggleLayerClicked: function (event) {
    event.stopPropagation();

    var savingOptions = {
      shouldPreserveAutoStyle: true
    };

    this.model.toggleVisible();
    this._userActions.saveLayer(this.model, savingOptions);
  },

  _onToggleContextMenuClicked: function (event) {
    event.stopPropagation();

    if (this._hasContextMenu()) {
      this._hideContextMenu();
    } else {
      this._showContextMenu({
        x: event.pageX,
        y: event.pageY
      });
    }
  },

  _hasContextMenu: function () {
    return this._menuView;
  },

  _hideContextMenu: function () {
    this.removeView(this._menuView);
    this._menuView.clean();
    delete this._menuView;
  },

  _showContextMenu: function (position) {
    var menuItems = new CustomListCollection([{
      label: this._isCollapsed() ? _t('editor.layers.options.expand') : _t('editor.layers.options.collapse'),
      val: 'collapse-expand-layer'
    }, {
      label: _t('editor.layers.options.rename'),
      val: 'rename-layer'
    }, {
      label: _t('editor.layers.options.export'),
      val: 'export-data'
    }, {
      label: _t('editor.layers.options.edit'),
      val: 'edit-layer'
    }]);
    if (this._queryGeometryHasGeom()) {
      menuItems.add({
        label: _t('editor.layers.options.center-map'),
        val: 'center-map'
      });
    }
    if (this.model.canBeDeletedByUser()) {
      menuItems.add({
        label: _t('editor.layers.options.delete'),
        val: 'delete-layer',
        destructive: true
      });
    }

    var triggerElementID = 'context-menu-trigger-' + this.model.cid;
    this.$('.js-toggle-menu').attr('id', triggerElementID);
    this._menuView = new ContextMenuView({
      collection: menuItems,
      triggerElementID: triggerElementID,
      position: position
    });

    menuItems.bind('change:selected', function (menuItem) {
      var selectedItem = menuItem.get('val');
      if (selectedItem === 'delete-layer') {
        this._confirmDeleteLayer();
      }
      if (selectedItem === 'collapse-expand-layer') {
        this._onToggleCollapsedLayer();
      }
      if (selectedItem === 'rename-layer') {
        this._inlineEditor.edit();
      }
      if (selectedItem === 'export-data') {
        this._exportLayer();
      }
      if (selectedItem === 'edit-layer') {
        this._onEditLayer();
      }
      if (selectedItem === 'center-map') {
        this._centerMap();
      }
    }, this);

    this._menuView.model.bind('change:visible', function (model, isContextMenuVisible) {
      if (this._hasContextMenu() && !isContextMenuVisible) {
        this._hideContextMenu();
      }
    }, this);

    this._menuView.show();
    this.addView(this._menuView);
  },

  _exportLayer: function () {
    var nodeDefModel = this.model.getAnalysisDefinitionNodeModel();
    var queryGeometryModel = nodeDefModel.queryGeometryModel;

    this._modals.create(function (modalModel) {
      return new ModalExportDataView({
        modalModel: modalModel,
        queryGeometryModel: queryGeometryModel,
        configModel: this._configModel,
        fileName: this.model.getName()
      });
    }.bind(this));
  },

  _confirmDeleteLayer: function () {
    this._modals.create(function (modalModel) {
      var deleteLayerConfirmationView = new DeleteLayerConfirmationView({
        userActions: this._userActions,
        modals: this._modals,
        layerModel: this.model,
        modalModel: modalModel,
        visDefinitionModel: this._visDefinitionModel,
        widgetDefinitionsCollection: this._widgetDefinitionsCollection
      });

      return deleteLayerConfirmationView;
    }.bind(this));
  },

  _renameLayer: function () {
    var newName = this._inlineEditor.getValue();

    if (newName !== '') {
      // Optimistic
      this._onSaveSuccess(newName);

      renameLayer({
        newName: newName,
        userActions: this._userActions,
        layerDefinitionsCollection: this._layerDefinitionsCollection,
        layerDefinitionModel: this.model,
        onError: this._onSaveError.bind(this)
      });
    }
  },

  _onSaveSuccess: function (newName) {
    this.$('.js-title').text(newName).show();
    this._inlineEditor.hide();
  },

  _onSaveError: function (oldName) {
    this.$('.js-title').text(oldName).show();
    this._inlineEditor.hide();
  },

  _onDestroy: function () {
    this.clean();
  },

  _disableEventsOnCapturePhase: function (evt) {
    evt.stopPropagation();
    evt.preventDefault();
  },

  _toggleClickEventsOnCapturePhase: function (str) {
    var addOrRemove = str === 'add'
      ? 'add'
      : 'remove';
    this.el[addOrRemove + 'EventListener']('click', this._disableEventsOnCapturePhase, true);
  },

  _centerMap: function () {
    var nodeModel = this.model.getAnalysisDefinitionNodeModel();
    var query = nodeModel.querySchemaModel.get('query');
    zoomToData(this._configModel, this._stateDefinitionModel, query);
  },

  _queryGeometryHasGeom: function () {
    return !!this._queryGeometryModel.hasValue();
  },

  clean: function () {
    this._toggleClickEventsOnCapturePhase('remove');
    CoreView.prototype.clean.apply(this);
  }
});
