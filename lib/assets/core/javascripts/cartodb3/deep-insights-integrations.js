var _ = require('underscore');
var $ = require('jquery');
var linkLayerInfowindow = require('./deep-insights-integration/link-layer-infowindow');
var linkLayerTooltip = require('./deep-insights-integration/link-layer-tooltip');
var LegendManager = require('./deep-insights-integration/legend-manager');
var AnalysisNotifications = require('./editor/layers/analysis-views/analysis-notifications');
var WidgetsNotifications = require('./widgets-notifications');
var AnalysisOnboardingLauncher = require('./components/onboardings/analysis/analysis-launcher');
var NotificationErrorMessageHandler = require('./editor/layers/notification-error-message-handler');
var VisNotifications = require('./vis-notifications');
var WidgetsService = require('./editor/widgets/widgets-service');
var WidgetDefinitionModel = require('./data/widget-definition-model');
var FeatureDefinitionModel = require('./data/feature-definition-model');
var Notifier = require('./components/notifier/notifier');
var layerTypesAndKinds = require('./data/layer-types-and-kinds');
var basemapProvidersAndCategories = require('./data/basemap-providers-and-categories');

/**
 * Integration between various data collections/models with cartodb.js and deep-insights.
 */
var F = function (opts) {
  if (!opts.deepInsightsDashboard) throw new Error('deepInsightsDashboard is required');
  if (!opts.analysisDefinitionNodesCollection) throw new Error('analysisDefinitionNodesCollection is required');
  if (!opts.analysisDefinitionsCollection) throw new Error('analysisDefinitionsCollection is required');
  if (!opts.layerDefinitionsCollection) throw new Error('layerDefinitionsCollection is required');
  if (!opts.widgetDefinitionsCollection) throw new Error('widgetDefinitionsCollection is required');
  if (!opts.legendDefinitionsCollection) throw new Error('legendDefinitionsCollection is required');
  if (!opts.visDefinitionModel) throw new Error('visDefinitionModel is required');
  if (!opts.userModel) throw new Error('userModel is required');
  if (!opts.onboardings) throw new Error('onboardings is required');
  if (!opts.mapDefinitionModel) throw new Error('mapDefinitionModel is required');
  if (!opts.stateDefinitionModel) throw new Error('stateDefinitionModel is required');
  if (!opts.overlayDefinitionsCollection) throw new Error('overlayDefinitionsCollection is required');
  if (!opts.mapModeModel) throw new Error('mapModeModel is required');
  if (!opts.configModel) throw new Error('configModel is required');
  if (!opts.editorModel) throw new Error('editorModel is required');
  if (!opts.editFeatureOverlay) throw new Error('editFeatureOverlay is required');

  this._diDashboard = opts.deepInsightsDashboard;
  this._analysisDefinitionNodesCollection = opts.analysisDefinitionNodesCollection;
  this._analysisDefinitionsCollection = opts.analysisDefinitionsCollection;
  this._layerDefinitionsCollection = opts.layerDefinitionsCollection;
  this._visDefinitionModel = opts.visDefinitionModel;
  this._stateDefinitionModel = opts.stateDefinitionModel;
  this._userModel = opts.userModel;
  this._mapDefinitionModel = opts.mapDefinitionModel;
  this._onboardings = opts.onboardings;
  this._overlayDefinitionsCollection = opts.overlayDefinitionsCollection;
  this._mapModeModel = opts.mapModeModel;
  this._configModel = opts.configModel;
  this._widgetDefinitionsCollection = opts.widgetDefinitionsCollection;
  this._editorModel = opts.editorModel;
  this._editFeatureOverlay = opts.editFeatureOverlay;
  this._legendsDefinitionCollection = opts.legendDefinitionsCollection;

  this._layerDefinitionsCollection.each(this._linkLayerErrors, this);

  this._analysisDefinitionNodesCollection.on('add', this._analyseDefinitionNode, this);
  this._analysisDefinitionNodesCollection.on('change', this._analyseDefinitionNode, this);
  this._analysisDefinitionNodesCollection.on('change:id', this._onAnalysisDefinitionNodeIdChanged, this);
  this._analysisDefinitionNodesCollection.on('remove', this._onAnalysisDefinitionNodeRemoved, this);
  this._analysisDefinitionsCollection.on('add change:node_id sync', this._analyseDefinition, this);

  opts.layerDefinitionsCollection.on('add', this._onLayerDefinitionAdded, this);
  opts.layerDefinitionsCollection.on('sync', this._onLayerDefinitionSynced, this);
  opts.layerDefinitionsCollection.on('change', this._onLayerDefinitionChanged, this);
  opts.layerDefinitionsCollection.on('remove', this._onLayerDefinitionRemoved, this);
  opts.layerDefinitionsCollection.on('layerMoved', this._onLayerDefinitionMoved, this);
  opts.layerDefinitionsCollection.on('baseLayerChanged', this._onBaseLayerChanged, this);

  opts.layerDefinitionsCollection.each(function (layerDefModel) {
    LegendManager.track(layerDefModel);

    linkLayerInfowindow(layerDefModel, this.visMap());
    linkLayerTooltip(layerDefModel, this.visMap());

    if (layerDefModel.has('source')) {
      this._resetStylesIfNoneApplied(layerDefModel);
    }
  }, this);

  opts.legendDefinitionsCollection.on('add', this._onLegendDefinitionAdded, this);
  opts.legendDefinitionsCollection.on('change', this._onLegendDefinitionChanged, this);
  opts.legendDefinitionsCollection.on('remove', this._onLegendDefinitionRemoved, this);

  opts.widgetDefinitionsCollection.on('add', this._onWidgetDefinitionAdded, this);
  opts.widgetDefinitionsCollection.on('sync', this._onWidgetDefinitionSynced, this);
  opts.widgetDefinitionsCollection.on('change', this._onWidgetDefinitionChanged, this);
  opts.widgetDefinitionsCollection.on('destroy', this._onWidgetDefinitionDestroyed, this);
  opts.widgetDefinitionsCollection.on('add remove reset', this._invalidateSize, this);

  opts.widgetDefinitionsCollection.each(this._onWidgetDefinitionAdded, this);

  opts.overlayDefinitionsCollection.on('add', this._onOverlayDefinitionAdded, this);
  opts.overlayDefinitionsCollection.on('remove', this._onOverlayDefinitionRemoved, this);

  opts.mapDefinitionModel.on('change:minZoom change:maxZoom', _.debounce(this._onMinMaxZoomChanged.bind(this), 300), this);
  opts.mapDefinitionModel.on('change:scrollwheel', this._onScrollWheelChanged, this);
  opts.mapDefinitionModel.on('change:legends', this._onLegendsChanged, this);
  opts.mapDefinitionModel.on('change:layer_selector', this._onLayerSelectorChanged, this);

  this._onScrollWheelChanged();

  WidgetsNotifications.track(this._widgetDefinitionsCollection);

  opts.editorModel.on('change:settingsView', this._onEditorSettingsChanged, this);

  this._analysisDefinitionsCollection.each(this._analyseDefinition, this);
  this._vis().on('reload', this._visReload, this);
  this._vis().on('change:error', this._visErrorChange, this);

  var saveStateDefinition = _.debounce(this._saveStateDefinition.bind(this), 500);
  this._diDashboard.onStateChanged(saveStateDefinition);
  this._stateDefinitionModel.on('boundsSet', this._onBoundsSet, this);

  // In order to sync layer selector and layer visbility
  this._getLayers().on('change:visible', function (layer, visible) {
    var layerDefModel = opts.layerDefinitionsCollection.findWhere({id: layer.id});
    if (layerDefModel) {
      if (layerDefModel.get('visible') !== visible) {
        layerDefModel.save({visible: visible});
      }
    }
  }, this);

  VisNotifications.track(this._vis());

  opts.mapModeModel.on('change:mode', this._onMapModeChanged, this);

  this.visMap().on('featureClick', this._onFeatureClicked, this);
  this.visMap().on('mapViewSizeChanged', this._setMapViewSize, this);

  // Needed to image export feature
  this._getVisMetadata();
  this._setMapConverters();
  this._setMapViewSize();
};

F.prototype._onFeatureClicked = function (event) {
  var layerId = event.layer.id;
  var featureId = event.feature.cartodb_id;
  var position = event.position;
  var layerDefinitionModel = this._layerDefinitionsCollection.get(layerId);
  var isFeatureBeingEdited = false;

  var featureDefinition = new FeatureDefinitionModel({
    cartodb_id: featureId
  }, {
    configModel: this._configModel,
    layerDefinitionModel: layerDefinitionModel,
    userModel: this._userModel
  });

  if (this._mapModeModel.isEditingFeatureMode()) {
    var editingFeatureDefinitionModel = this._mapModeModel.getFeatureDefinition();
    isFeatureBeingEdited = featureDefinition.isEqual(editingFeatureDefinitionModel);
  }

  if (!isFeatureBeingEdited) {
    this._editFeatureOverlay.setPosition(position);
    this._editFeatureOverlay.setFeatureDefinition(featureDefinition);
    this._editFeatureOverlay
      .render()
      .show();
  }
};

F.prototype._onMapModeChanged = function (mapModeModel) {
  var map = this.visMap();
  var featureDefinition;
  var geometry;

  // VIEWING MODE
  if (mapModeModel.isViewingMode()) {
    map.stopDrawingGeometry();
    map.stopEditingGeometry();
  }

  // DRAWING FEATURES
  if (mapModeModel.isDrawingFeatureMode()) {
    featureDefinition = mapModeModel.getFeatureDefinition();
    if (featureDefinition.isPoint()) {
      geometry = map.drawPoint();
    } else if (featureDefinition.isLine()) {
      geometry = map.drawPolyline();
    } else if (featureDefinition.isPolygon()) {
      geometry = map.drawPolygon();
    }

    if (!geometry) {
      throw new Error("couldn't get geometry for feature of type " + featureDefinition.get('type'));
    }
  }

  // EDITING FEATURES
  if (mapModeModel.isEditingFeatureMode()) {
    featureDefinition = mapModeModel.getFeatureDefinition();
    var geojson = JSON.parse(featureDefinition.get('the_geom'));
    geometry = map.editGeometry(geojson);
  }

  if (featureDefinition && geometry) {
    this._bindGeometryToFeatureDefinition(geometry, featureDefinition);
    featureDefinition.on('save', function () {
      if (featureDefinition.hasBeenChangedAfterLastSaved('the_geom') || featureDefinition.hasBeenChangedAfterLastSaved('cartodb_id')) {
        this._invalidateMap();
        geometry.setCoordinatesFromGeoJSON(JSON.parse(featureDefinition.get('the_geom')));
      }
    }, this);
    featureDefinition.on('remove', function () {
      this._invalidateMap();
    }, this);
  }
};

F.prototype._bindGeometryToFeatureDefinition = function (geometry, featureDefinition) {
  geometry.on('change', function () {
    if (geometry.isComplete()) {
      $('.js-editOverlay').fadeOut(200, function () {
        $('.js-editOverlay').remove();
      });

      var geojson = geometry.toGeoJSON();
      geojson = geojson.geometry || geojson;
      featureDefinition.set({
        the_geom: JSON.stringify(geojson)
      });
      featureDefinition.trigger('updateFeature');
    }
  });
};

F.prototype._resetStylesIfNoneApplied = function (layerDefModel) {
  var nodeDefModel = layerDefModel.getAnalysisDefinitionNodeModel();
  var analysisCollection = this._analysis();
  var nodeModel = analysisCollection && analysisCollection.findNodeById(layerDefModel.get('source'));
  var isAnalysisNode = nodeModel && nodeModel.get('type') !== 'source';
  var isDone = nodeModel && nodeModel.isDone();
  var queryGeometryModel = nodeDefModel.queryGeometryModel;
  var styleModel = layerDefModel.styleModel;

  if (isAnalysisNode && styleModel.hasNoneStyles() && isDone) {
    var simpleGeom = queryGeometryModel.get('simple_geom');

    var applyDefaultStyles = function () {
      simpleGeom = queryGeometryModel.get('simple_geom');
      styleModel.setDefaultPropertiesByType('simple', simpleGeom);
    };

    if (!simpleGeom) {
      queryGeometryModel.once('change:simple_geom', applyDefaultStyles, this);
      queryGeometryModel.fetch();
    } else {
      applyDefaultStyles();
    }
  }
};

F.prototype._visReload = function () {
  this._getVisMetadata();
  this._visDefinitionModel.trigger('vis:reload');
  this._visDefinitionModel.recordChange();
};

F.prototype._getVisMetadata = function () {
  var vis = this._vis();
  var map = this.visMap();
  var layers = this._getLayers();

  var imageExportMetadata = {
    zoom: map.get('zoom'),
    mapType: map.getBaseLayer().get('baseType'),
    style: layers.at(0).get('style'),
    attribution: map.get('attribution'),
    provider: map.get('provider')
  };

  this._mapDefinitionModel.setImageExportMetadata(imageExportMetadata);
  this._mapDefinitionModel.setStaticImageURLTemplate(vis.getStaticImageURL.bind(vis));
};

F.prototype._setMapConverters = function () {
  var map = this.visMap();
  this._mapDefinitionModel.setConverters({
    pixelToLatLng: map.pixelToLatLng(),
    latLngToPixel: map.latLngToPixel()
  });
};

F.prototype._setMapViewSize = function () {
  this._mapDefinitionModel.setMapViewSize(this.visMap().getMapViewSize());
};

F.prototype._visErrorChange = function () {
  this._visDefinitionModel && this._visDefinitionModel.trigger('vis:error', this._vis().get('error'));
};

F.prototype._analyseDefinition = function (m) {
  var id = m.get('node_id');
  var nodeDefModel = this._analysisDefinitionNodesCollection.get(id);
  this._analyseDefinitionNode(nodeDefModel);
};

F.prototype._analyseDefinitionNode = function (m) {
  if (!this._hasUpdateOnlyNodeAnalysisId(m)) {
    var attrs = m.toJSON({ skipOptions: true });
    this._analysis().analyse(attrs);

    // Unfortunately have to try to setup sync until this point, since a node doesn't exist until after analyse call
    this._analysisDefinitionNodesCollection.each(this._tryToSetupDefinitionNodeSync, this);
  }
};

F.prototype._onAnalysisDefinitionNodeIdChanged = function (m, changedAttributes) {
  if (this._hasUpdateOnlyNodeAnalysisId(m)) {
    var node = this._analysis().findNodeById(m.previous('id'));
    node && node.set('id', m.id);
  }
};

F.prototype._onAnalysisDefinitionNodeRemoved = function (m) {
  var node = this._analysis().findNodeById(m.id);
  if (node) {
    node.set({avoidNotification: (m && !!m.get('avoidNotification'))}, {silent: true});
    node.remove();
  }
};

F.prototype._hasUpdateOnlyNodeAnalysisId = function (nodeDefModel) {
  return nodeDefModel.hasChanged('id') && _.size(nodeDefModel.changed) === 1;
};

F.prototype._tryToSetupDefinitionNodeSync = function (m) {
  if (m.__syncSetup) return; // only setup once

  var node = this._analysis().findNodeById(m.id);
  var layerDefModel = this._layerDefinitionsCollection.findOwnerOfAnalysisNode(m);
  if (!node) return; // might not exist when method is called, so do nothing to allow retries

  m.__syncSetup = true;

  // Don't need to sync source nodes
  if (node.get('type') !== 'source') {
    AnalysisNotifications.track(node, layerDefModel);

    var updateAnalysisQuerySchema = function () {
      var query = node.get('query');
      var status = node.get('status');
      var error = node.get('error');

      m.querySchemaModel.set({
        query: query,
        ready: status === 'ready'
      });
      m.queryGeometryModel.set({
        query: query,
        ready: status === 'ready'
      });
      m.set({ status: status, error: error });
    };

    AnalysisOnboardingLauncher.init({
      onboardings: this._onboardings,
      userModel: this._userModel
    });

    m.listenTo(node, 'change:status', function (model, status) {
      m.set('status', status);

      if (status === 'ready' && m.USER_SAVED) {
        AnalysisOnboardingLauncher.launch(node.get('type'), model);
        m.USER_SAVED = false;
      }
    });

    updateAnalysisQuerySchema();

    m.listenTo(node, 'change', updateAnalysisQuerySchema);
    m.listenToOnce(node, 'destroy', m.stopListening);
  } else {
    m.listenTo(m.querySchemaModel, 'resetDueToAlteredData', this._invalidateMap.bind(this));
  }
};

F.prototype._onWidgetDefinitionAdded = function (m) {
  var widgetModel = this._diDashboard.getWidget(m.id);
  if (widgetModel) {
    widgetModel.set({
      show_stats: true,
      show_options: true
    });

    this._bindWidgetChanges(widgetModel);
  }
};

F.prototype._onWidgetDefinitionSynced = function (m) {
  var widgetModel = this._diDashboard.getWidget(m.id);
  if (!widgetModel) {
    this._createWidgetModel(m);
  }
};

F.prototype._onWidgetAutoStyleColorChanged = function (m) {
  var isAutoStyleApplied = m.isAutoStyle();
  var autoStyleInfo = m.getAutoStyle();
  var layerId = m.dataviewModel.layer.id;
  var layerDefModel = this._layerDefinitionsCollection.findWhere({ id: layerId });
  var nodeDefModel = layerDefModel && layerDefModel.getAnalysisDefinitionNodeModel();
  var styleModel = layerDefModel && layerDefModel.styleModel;
  var geometryType = nodeDefModel && nodeDefModel.get('simple_geom');

  if (layerDefModel) {
    layerDefModel.set({
      autoStyle: isAutoStyleApplied ? m.id : false,
      cartocss: autoStyleInfo.cartocss
    });
  }

  if (isAutoStyleApplied && styleModel && geometryType) {
    styleModel.setPropertiesFromAutoStyle({
      definition: autoStyleInfo.definition,
      geometryType: geometryType,
      widgetId: m.id
    });
  }
};

F.prototype._onWidgetAutoStyleChanged = function (m) {
  var isAutoStyleApplied = m.isAutoStyle();
  var autoStyleInfo = m.getAutoStyle();
  var layerId = m.dataviewModel.layer.id;
  var layerDefModel = this._layerDefinitionsCollection.findWhere({ id: layerId });
  var nodeDefModel = layerDefModel && layerDefModel.getAnalysisDefinitionNodeModel();
  var styleModel = layerDefModel && layerDefModel.styleModel;
  var onLayerChange = _.debounce(function () {
    var dontResetStyles = true; // In order to make it more visible
    m.cancelAutoStyle(dontResetStyles);
  }, 10);

  if (layerDefModel && nodeDefModel) {
    if (isAutoStyleApplied) {
      layerDefModel.set({
        autoStyle: m.id
      });
    }
  } else {
    return;
  }

  if (isAutoStyleApplied) {
    var geometryType = nodeDefModel.get('simple_geom');
    styleModel.setPropertiesFromAutoStyle({
      definition: autoStyleInfo.definition,
      geometryType: geometryType,
      widgetId: m.id
    });

    layerDefModel.set({
      cartocss: autoStyleInfo.cartocss,
      cartocss_custom: false,
      previousCartoCSSCustom: layerDefModel.attributes.cartocss_custom,
      previousCartoCSS: layerDefModel.get('cartocss')
    });

    layerDefModel.once('change:autoStyle change:cartocss', onLayerChange, this);
  } else {
    layerDefModel.unbind('change:autoStyle change:cartocss', onLayerChange, this);
    var autoStyleId = layerDefModel.get('autoStyle');

    if (autoStyleId && autoStyleId === m.id) {
      styleModel.resetPropertiesFromAutoStyle();

      layerDefModel.set({
        autoStyle: false,
        cartocss_custom: layerDefModel.get('previousCartoCSSCustom'),
        cartocss: layerDefModel.get('previousCartoCSS')
      });

      // Because we are messing with the autoStyle property on saving,
      // whenever we disable autoStyle, we save the layer to force
      // the sync on the cartocss
      layerDefModel.save();
    }
  }
};

F.prototype._onWidgetCustomAutoStyleColorChanged = function (m) {
  var isAutoStyleApplied = m.isAutoStyle();
  var autoStyleInfo = m.getAutoStyle();
  var layerId = m.dataviewModel.layer.id;
  var layerDefModel = this._layerDefinitionsCollection.findWhere({ id: layerId });
  var nodeDefModel = layerDefModel && layerDefModel.getAnalysisDefinitionNodeModel();
  var styleModel = layerDefModel && layerDefModel.styleModel;

  if (isAutoStyleApplied) {
    var geometryType = nodeDefModel.get('simple_geom');
    styleModel.setPropertiesFromAutoStyle({
      definition: autoStyleInfo.definition,
      geometryType: geometryType,
      widgetId: m.id
    });

    layerDefModel.set({
      cartocss: autoStyleInfo.cartocss,
      cartocss_custom: false
    }, {silent: true});

    // In order to make legends aware
    styleModel.trigger('style:update');
  }
};

F.prototype._onWidgetDefinitionChanged = function (m) {
  var widgetModel = this._diDashboard.getWidget(m.id);

  // Only try to update if there's a corresponding widget model
  // E.g. the change of type will remove the model and provoke change events, which are not of interest (here),
  // since the widget model should be re-created for the new type anyway.
  if (widgetModel) {
    if (m.hasChanged('type')) {
      widgetModel.remove();
      this._createWidgetModel(m);
    } else {
      var attrs = this._formatWidgetAttrs(m.changedAttributes(), m);
      widgetModel.update(attrs);
    }
  }
};

F.prototype._onWidgetDefinitionDestroyed = function (m) {
  var widgetModel = this._diDashboard.getWidget(m.id);

  if (widgetModel) {
    if (widgetModel.isAutoStyle()) {
      widgetModel.cancelAutoStyle();
    }
    this._unbindWidgetChanges(widgetModel);
    widgetModel.remove();
  }
};

F.prototype._onEditWidget = function (m) {
  var widgetDefModel = this._widgetDefinitionsCollection.get(m.id);
  if (widgetDefModel) {
    WidgetsService.editWidget(widgetDefModel);
  }
};

F.prototype._onRemoveWidget = function (m) {
  var widgetDefModel = this._widgetDefinitionsCollection.get(m.id);
  if (widgetDefModel) {
    WidgetsService.removeWidget(widgetDefModel);
  }
};

F.prototype._bindWidgetChanges = function (m) {
  m.bind('editWidget', this._onEditWidget, this);
  m.bind('removeWidget', this._onRemoveWidget, this);
  m.bind('customAutoStyle', this._onWidgetCustomAutoStyleColorChanged, this);
  m.bind('change:autoStyle', this._onWidgetAutoStyleChanged, this);
  m.bind('change:color', this._onWidgetAutoStyleColorChanged, this);
};

F.prototype._unbindWidgetChanges = function (m) {
  m.unbind('editWidget', this._onEditWidget, this);
  m.unbind('removeWidget', this._onRemoveWidget, this);
  m.unbind('customAutoStyle', this._onWidgetCustomAutoStyleColorChanged, this);
  m.unbind('change:autoStyle', this._onWidgetAutoStyleChanged, this);
  m.unbind('change:color', this._onWidgetAutoStyleColorChanged, this);
};

F.prototype._createWidgetModel = function (m) {
  // e.g. 'time-series' => createTimeSeriesWidget
  var infix = m.get('type').replace(/(^\w|-\w)/g, function (match) {
    return match.toUpperCase().replace('-', '');
  });
  var methodName = 'create' + infix + 'Widget';

  var layerModel = this.visMap().getLayerById(m.get('layer_id'));
  var attrs = this._formatWidgetAttrs(m.attributes, m);

  var widgetModel = this._diDashboard[methodName](attrs, layerModel);

  if (widgetModel) {
    widgetModel.set({
      show_stats: true,
      show_options: true
    });

    this._bindWidgetChanges(widgetModel);
  }
};

/**
 * Massage some data points to the expected format of deep-insights API
 */
F.prototype._formatWidgetAttrs = function (changedAttrs, widgetDefModel) {
  var widgetStyleParams = ['widget_style_definition', 'auto_style_definition', 'auto_style_allowed'];
  var formattedAttrs = changedAttrs;

  // Source formatting
  if (_.isString(formattedAttrs.source)) {
    formattedAttrs = _.omit(formattedAttrs, 'source');
    formattedAttrs.source = {id: changedAttrs.source};
  }

  // Widget style or auto style changes
  var thereIsWidgetStyleChange = _.find(formattedAttrs, function (value, key) {
    return _.contains(widgetStyleParams, key);
  });

  if (!_.isUndefined(thereIsWidgetStyleChange)) {
    formattedAttrs = _.omit(formattedAttrs, widgetStyleParams);
    formattedAttrs.style = widgetDefModel.toJSON().style;
  }

  return formattedAttrs;
};

F.prototype._onLayerDefinitionAdded = function (m, c, opts) {
  // Base and labels layers are synced in a separate method
  if (!layerTypesAndKinds.isTypeDataLayer(m.get('type'))) {
    return;
  }

  // If added but not yet saved, postpone the creation until persisted (see sync listener)
  if (!m.isNew()) {
    if (!this._getLayer(m)) {
      this._createLayer(m);
    } else {
      // we need to sync model positions
      this._tryUpdateLayerPosition(m);
    }
  }
};

F.prototype._tryUpdateLayerPosition = function (m) {
  var builderPosition = this._layerDefinitionsCollection.indexOf(m);
  var cdbLayer = this._getLayer(m);
  var cdbPosition;

  if (cdbLayer) {
    cdbPosition = this._getLayers().indexOf(cdbLayer);
  }

  var indexChanges = m.isDataLayer() && cdbPosition > 0 && builderPosition > 0 && builderPosition !== cdbPosition;

  if (indexChanges) {
    this.visMap().moveCartoDBLayer(cdbPosition, builderPosition);
  }
};

F.prototype._onLayerDefinitionSynced = function (m) {
  // Base and labels layers are synced in a separate method
  if (!layerTypesAndKinds.isTypeDataLayer(m.get('type'))) {
    return;
  }

  if (!this._getLayer(m)) {
    this._createLayer(m);
  }
};

F.prototype._onLayerDefinitionChanged = function (layerDefinitionModel, changedAttributes) {
  var attrs = layerDefinitionModel.changedAttributes();
  var attrsNames = _.keys(attrs);

  // Base and labels layers are synced in a separate method
  if (!layerTypesAndKinds.isTypeDataLayer(layerDefinitionModel.get('type'))) {
    return;
  }

  // return if only the 'error' attribute has changed (no need to sync anything)
  if (attrsNames.length === 1 && attrsNames[0] === 'error') {
    return;
  }

  var layer = this._getLayer(layerDefinitionModel);
  if (!layerDefinitionModel.isNew()) {
    if (!layer) {
      this._createLayer(layerDefinitionModel);
      return;
    }

    if (attrs.type) {
      layer.remove();
      this._createLayer(layerDefinitionModel);
    } else {
      if (layerDefinitionModel.get('source') && !layer.get('source')) {
        attrs.source = layerDefinitionModel.get('source');
      }
      attrs = this._adaptAttrsToCDBjs(layerDefinitionModel.get('type'), attrs);
      layer.update(attrs);
    }
    this._manageTimeSeriesForTorque(layerDefinitionModel);
  }
};

F.prototype._onBaseLayerChanged = function () {
  var baseLayerDefinition = this._layerDefinitionsCollection.getBaseLayer();
  var newBaseLayerAttrs = baseLayerDefinition.changedAttributes();

  var newBaseLayerType = baseLayerDefinition.get('type');
  var newMapProvider = basemapProvidersAndCategories.getProvider(newBaseLayerType);
  var mapProviderChanged = false;
  if (baseLayerDefinition.hasChanged('type')) {
    var previousBaseLayerType = baseLayerDefinition.previous('type');
    var previousMapProvider = basemapProvidersAndCategories.getProvider(previousBaseLayerType);
    mapProviderChanged = previousMapProvider !== newMapProvider;
  }

  // If the map provider has changed (eg: Leaflet -> Google Maps), we add/update/remove base and
  // labels layers silently so that CartoDB.js doesn't pick up those changes and tries to add/update/remove
  // layers until the new map provider has been set
  var handleLayersSilently = mapProviderChanged;

  // Base layer
  var cdbjsLayer = this._getLayer(baseLayerDefinition);

  // If the type of base layer has changed. eg: Tiled -> Plain
  if (newBaseLayerAttrs.type) {
    cdbjsLayer.remove({ silent: handleLayersSilently });
    this._createLayer(baseLayerDefinition, { silent: handleLayersSilently });
  } else {
    cdbjsLayer.update(this._adaptAttrsToCDBjs(baseLayerDefinition.get('type'), newBaseLayerAttrs), {
      silent: handleLayersSilently
    });
  }

  // Labels layer
  var labelsLayerDefinition = this._layerDefinitionsCollection.getLabelsLayer();
  var cdbjsTopLayer = this._getLayers().last();
  var cdbjsHasLabelsLayer = cdbjsTopLayer.get('type') === 'Tiled';

  if (labelsLayerDefinition) {
    if (cdbjsHasLabelsLayer) {
      var changedAttrs = labelsLayerDefinition.changedAttributes();
      if (changedAttrs) {
        cdbjsTopLayer.update(this._adaptAttrsToCDBjs(labelsLayerDefinition.get('type'), changedAttrs), {
          silent: handleLayersSilently
        });
      }
    } else {
      this._createLayer(labelsLayerDefinition, { silent: handleLayersSilently });
    }
  } else if (cdbjsHasLabelsLayer) {
    cdbjsTopLayer.remove({ silent: handleLayersSilently });
  }

  // Map provider
  this.visMap().set('provider', newMapProvider);

  if (handleLayersSilently) {
    // Reload map if everything (previously) was done silently
    this._diDashboard.reloadMap();
  }

  // Render again the edit-feature-overlay, in order to
  // decide if delegate or not events
  this._editFeatureOverlay.render();
  this._setMapConverters();
};

var CARTODBJS_TO_CARTODB_ATTRIBUTE_MAPPINGS = {
  'layer_name': ['table_name_alias', 'table_name']
};

var BLACKLISTED_LAYER_DEFINITION_ATTRS = {
  'all': [ 'letter', 'kind' ],
  'Tiled': [ 'category', 'selected', 'highlighted' ],
  'CartoDB': [ 'color', 'letter' ],
  'torque': [ 'color', 'letter' ]
};

F.prototype._adaptAttrsToCDBjs = function (layerType, attrs) {
  attrs = _.omit(attrs, BLACKLISTED_LAYER_DEFINITION_ATTRS['all'], BLACKLISTED_LAYER_DEFINITION_ATTRS[layerType]);
  _.each(CARTODBJS_TO_CARTODB_ATTRIBUTE_MAPPINGS, function (cdbAttrs, cdbjsAttr) {
    _.each(cdbAttrs, function (cdbAttr) {
      if (attrs[cdbAttr] && !attrs[cdbjsAttr]) {
        attrs[cdbjsAttr] = attrs[cdbAttr];
      }
    });
  });

  return attrs;
};

F.prototype._onLegendDefinitionAdded = function (m) {
  var layerDefModel = m.layerDefinitionModel;
  var layer = this._getLayer(layerDefModel);
  var type = m.get('type');
  var legend;
  if (layer && layer.legends) {
    legend = layer.legends[type];
    if (legend) {
      legend.reset();
      legend.set(m.getAttributes());
      legend.show();
    }
  }
};

F.prototype._onLegendDefinitionRemoved = function (m) {
  var layerDefModel = m.layerDefinitionModel;
  var layer = this._getLayer(layerDefModel);
  var type = m.get('type');
  var legend;
  if (layer && layer.legends) {
    legend = layer.legends[type];
    legend && legend.hide();
  }
};

F.prototype._onLegendDefinitionChanged = function (m) {
  var layerDefModel = m.layerDefinitionModel;
  var layer = this._getLayer(layerDefModel);
  var type = m.get('type');
  var legend;
  if (layer && layer.legends) {
    legend = layer.legends[type];
    if (legend) {
      legend.reset();
      legend.set(m.getAttributes());
    }
  }
};

F.prototype._manageTimeSeriesForTorque = function (m) {
  function recreateWidget (currentTimeseries, newLayer, animated) {
    var persistName = currentTimeseries && currentTimeseries.get('title');
    this._createTimeseries(newLayer, animated, persistName);
  }

  // not a cartodb layer
  if (!m.styleModel) return;
  var animatedChanged = m.styleModel.changedAttributes().animated;
  var attributeChanged;
  if (animatedChanged) attributeChanged = animatedChanged.attribute;
  var typeChanged = m.styleModel.changedAttributes().type;
  var animatedAttribute = m.styleModel.get('animated') && m.styleModel.get('animated').attribute;
  var previousType = m.styleModel.previous('type');

  if (!typeChanged && !attributeChanged) return;

  var type = m.styleModel.get('type');
  var widgetModel = this._diDashboard.getWidgets().filter(function (m) {
    return m.get('type') === 'time-series';
  })[0];

  var currentTimeseries = this._getTimeseriesDefinition();
  var persistWidget = !!currentTimeseries && currentTimeseries.get('title') !== 'time_date__t';
  var newLayer = this._getLayer(m);

  if (type !== 'animation' && previousType === 'animation' && this._lastType !== type) {
    if (widgetModel) {
      this._removeTimeseries();
    }

    if (persistWidget) {
      recreateWidget.call(this, currentTimeseries, newLayer, _.extend({ animated: false }, animatedChanged, { attribute: animatedAttribute }));
    }
    this._lastType = type;
    this._lastTSAnimateChange = '';
  }

  if (type === 'animation' && (this._lastTSAnimateChange !== attributeChanged || this._lastType !== 'animation')) {
    if (widgetModel) {
      this._removeTimeseries();
    }

    if (newLayer.get('type') === 'torque' || m.get('type') === 'torque' || persistWidget) {
      recreateWidget.call(this, currentTimeseries, newLayer, _.extend({ animated: true }, animatedChanged, { attribute: animatedAttribute }));
    }

    this._lastType = type;
    this._lastTSAnimateChange = attributeChanged;
  }
};

F.prototype._removeTimeseries = function () {
  this._widgetDefinitionsCollection.models.forEach(function (def) {
    if (def.get('type') === 'time-series') {
      def.set({avoidNotification: true}, {silent: true});
      def.destroy();
    }
  });
};

F.prototype._getTimeseriesDefinition = function () {
  return this._widgetDefinitionsCollection.where({type: 'time-series'})[0];
};

F.prototype._createTimeseries = function (newLayer, animatedChanged, persist) {
  this._removeTimeseries();
  var attribute = animatedChanged && animatedChanged.attribute || '';
  var animated = animatedChanged && animatedChanged.animated;
  if (attribute) {
    var baseAttrs = {
      type: 'time-series',
      layer_id: newLayer.get('id'),
      source: {
        id: newLayer.get('source')
      },
      options: {
        column: attribute,
        title: persist || 'time_date__t',
        bins: 256,
        animated: animated
      },
      style: {
        widget_style: WidgetDefinitionModel.getDefaultWidgetStyle('time-series')
      }
    };
    this._widgetDefinitionsCollection.create(baseAttrs, {wait: true});
  }
};

F.prototype._onLayerDefinitionRemoved = function (m) {
  if (!m.isNew()) {
    var layer = this._getLayer(m);
    layer && layer.remove();
  }
};

F.prototype._onLayerDefinitionMoved = function (m, from, to) {
  this.visMap().moveCartoDBLayer(from, to);
};

var LAYER_TYPE_TO_LAYER_CREATE_METHOD = {
  'cartodb': 'createCartoDBLayer',
  'gmapsbase': 'createGMapsBaseLayer',
  'plain': 'createPlainLayer',
  'tiled': 'createTileLayer',
  'torque': 'createTorqueLayer',
  'wms': 'createWMSLayer'
};

F.prototype._createLayer = function (layerDefModel, options) {
  options = options || {};
  var attrs = JSON.parse(JSON.stringify(layerDefModel.attributes)); // deep clone
  attrs = this._adaptAttrsToCDBjs(layerDefModel.get('type'), attrs);

  // create the legends for the new layer
  var legends = this._legendsDefinitionCollection.findByLayerDefModel(layerDefModel);
  if (legends.length > 0) {
    attrs.legends = _.map(legends, function (legend) {
      return legend.toJSON();
    });
  }

  var createMethodName = LAYER_TYPE_TO_LAYER_CREATE_METHOD[attrs.type.toLowerCase()];
  if (!createMethodName) throw new Error('no create method name found for type ' + attrs.type);

  if (attrs.source) {
    // Make sure the analysis is created first
    var nodeDefModel = this._analysisDefinitionNodesCollection.get(attrs.source);
    this._analyseDefinitionNode(nodeDefModel);
  }

  var visMap = this.visMap();
  var layerPosition = this._layerDefinitionsCollection.indexOf(layerDefModel);
  visMap[createMethodName](attrs, _.extend({
    at: layerPosition
  }, options));

  linkLayerInfowindow(layerDefModel, visMap);
  linkLayerTooltip(layerDefModel, visMap);
  LegendManager.track(layerDefModel);

  this._linkLayerErrors(layerDefModel);
};

F.prototype._linkLayerErrors = function (m) {
  var layer = this._getLayer(m);
  if (layer) {
    if (layer.get('error')) {
      this._setLayerError(m, layer.get('error'));
    }
    layer.on('change:error', function (model, cdbError) {
      this._setLayerError(m, cdbError);
    }, this);
  }
};

F.prototype._setLayerError = function (layerDefinitionModel, cdbError) {
  var notification = Notifier.getNotification(layerDefinitionModel.id);
  var mainErrorMessage = layerDefinitionModel.getName() + ': ' + (cdbError && cdbError.message);

  if (!cdbError) {
    layerDefinitionModel.unset('error');
    notification && Notifier.removeNotification(notification);
    return;
  }

  var errorMessage = NotificationErrorMessageHandler.extractError(mainErrorMessage);

  if (notification) {
    notification.update({
      status: errorMessage.type,
      info: errorMessage.message
    });
  } else {
    Notifier.addNotification({
      id: layerDefinitionModel.id,
      status: errorMessage.type,
      closable: true,
      button: false,
      info: errorMessage.message
    });
  }

  if (cdbError.type === 'turbo-carto') {
    var line;
    try {
      line = cdbError.context.source.start.line;
    } catch (error) {}

    layerDefinitionModel.set('error', {
      type: cdbError.type,
      line: line,
      message: cdbError.message
    });
  } else if (errorMessage) {
    layerDefinitionModel.set('error', {
      type: errorMessage.type,
      message: errorMessage.message
    });
  }
};

F.prototype._onOverlayDefinitionAdded = function (mdl) {
  this._vis().overlaysCollection.add(mdl.toJSON());
};

F.prototype._onOverlayDefinitionRemoved = function (mdl) {
  var collection = this._vis().overlaysCollection;
  var overlay = collection.findWhere({ type: mdl.get('type') });
  overlay && collection.remove(overlay);
};

F.prototype._onMinMaxZoomChanged = function () {
  var currentZoom = this.visMap().get('zoom');
  var maxZoom = this._mapDefinitionModel.get('maxZoom');
  var minZoom = this._mapDefinitionModel.get('minZoom');

  this.visMap().set({
    minZoom: minZoom,
    maxZoom: maxZoom,
    zoom: Math.min(currentZoom, maxZoom)
  });
};

F.prototype._saveStateDefinition = function () {
  var state = this._diDashboard.getState();
  this._stateDefinitionModel.updateState(state);
  this._getVisMetadata();
};

F.prototype._onScrollWheelChanged = function () {
  var scrollwheel = this._mapDefinitionModel.get('scrollwheel');
  var method = scrollwheel ? 'enableScrollWheel' : 'disableScrollWheel';
  var map = this.visMap();
  map && map[method] && map[method]();
};

F.prototype._onLegendsChanged = function () {
  var legends = this._mapDefinitionModel.get('legends');
  this._vis().settings.set('showLegends', legends);
};

F.prototype._onLayerSelectorChanged = function () {
  var layerSelector = this._mapDefinitionModel.get('layer_selector');
  this._vis().settings.set('showLayerSelector', layerSelector);
};

F.prototype._onEditorSettingsChanged = function () {
  var settingsView = this._editorModel.get('settingsView');
  this._vis().settings.set('layerSelectorEnabled', settingsView);
};

F.prototype._getLayer = function (m) {
  return this.visMap().getLayerById(m.id);
};

F.prototype._getLayers = function (m) {
  return this.visMap().layers;
};

F.prototype.visMap = function () {
  return this._vis().map;
};

F.prototype._analysis = function () {
  return this._vis().analysis;
};

F.prototype._vis = function () {
  return this._diDashboard.getMap();
};

F.prototype._invalidateSize = function () {
  this._vis().invalidateSize();
};

F.prototype._invalidateMap = function () {
  this._vis().reload();
};

F.prototype._onBoundsSet = function (bounds) {
  this._diDashboard._dashboard.vis.map.setBounds(bounds);
};

module.exports = F;
