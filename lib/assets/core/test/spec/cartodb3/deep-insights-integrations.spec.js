var $ = require('jquery');
var _ = require('underscore');
var Backbone = require('backbone');
var ConfigModel = require('../../../javascripts/cartodb3/data/config-model');
var UserModel = require('../../../javascripts/cartodb3/data/user-model');
var deepInsights = require('cartodb-deep-insights.js');
var AnalysisOnboardingLauncher = require('../../../javascripts/cartodb3/components/onboardings/analysis/analysis-launcher');
var AnalysisDefinitionNodesCollection = require('../../../javascripts/cartodb3/data/analysis-definition-nodes-collection');
var AnalysisDefinitionsCollection = require('../../../javascripts/cartodb3/data/analysis-definitions-collection');
var DeepInsightsIntegrations = require('../../../javascripts/cartodb3/deep-insights-integrations');
var LayerDefinitionsCollection = require('../../../javascripts/cartodb3/data/layer-definitions-collection');
var LayerDefinitionModel = require('../../../javascripts/cartodb3/data/layer-definition-model');
var VisDefinitionModel = require('../../../javascripts/cartodb3/data/vis-definition-model');
var MapDefinitionModel = require('../../../javascripts/cartodb3/data/map-definition-model');
var LegendDefinitionsCollection = require('../../../javascripts/cartodb3/data/legends/legend-definitions-collection');
var LegendDefinitionModel = require('../../../javascripts/cartodb3/data/legends/legend-base-definition-model');
var LegendFactory = require('../../../javascripts/cartodb3/editor/layers/layer-content-views/legend/legend-factory');
var MapModeModel = require('../../../javascripts/cartodb3/map-mode-model');
var Notifier = require('../../../javascripts/cartodb3/components/notifier/notifier');
var StateDefinitionModel = require('../../../javascripts/cartodb3/data/state-definition-model');
var WidgetsService = require('../../../javascripts/cartodb3/editor/widgets/widgets-service');
var WidgetDefinitionsCollection = require('../../../javascripts/cartodb3/data/widget-definitions-collection');

var createOnboardings = function () {
  return {
    create: function () {
      return {};
    }
  };
};
var createFakeDashboard = function (layers) {
  var allLayersHaveIds = _.all(layers, function (layer) {
    return layer.get('id');
  });
  if (!allLayersHaveIds) {
    throw new Error('all layers in createFakeDashboard need to have an id');
  }

  var baseLayer = new Backbone.Model({
    baseType: 'wadus'
  });

  var fakeMap = new Backbone.Model();
  fakeMap.getLayerById = function (layerId) {
    return _.find(layers, function (layer) {
      return layer.get('id') === layerId;
    });
  };

  fakeMap.getBaseLayer = function () {
    return baseLayer;
  };

  fakeMap.pixelToLatLng = function (x, y) {
    return { lat: 123, lng: 456 };
  };

  fakeMap.latLngToPixel = function () {
    return { x: 100, y: 20 };
  };

  fakeMap.getMapViewSize = function () {
    return { x: 100, y: 100 };
  };

  var fakeVis = new Backbone.Model();
  fakeVis.map = fakeMap;
  fakeVis.getStaticImageURL = jasmine.createSpy('getStaticImageURL');

  var fakeDashboard = {
    widgets: {
      _widgetsCollection: new Backbone.Collection()
    }
  };

  return {
    getMap: function () {
      return fakeVis;
    },
    onStateChanged: function () {},
    _dashboard: fakeDashboard
  };
};

var createFakeLayer = function (attrs) {
  var layer = new Backbone.Model(attrs);
  layer.isVisible = function () { return true; };
  return layer;
};

describe('deep-insights-integrations/dii', function () {
  var el;
  var dashBoard;

  beforeEach(function (done) {
    spyOn(_, 'debounce').and.callFake(function (func) {
      return function () {
        func.apply(this, arguments);
      };
    });

    spyOn(AnalysisOnboardingLauncher, 'launch');
    spyOn(AnalysisOnboardingLauncher, 'init');

    var configModel = new ConfigModel({
      base_url: 'pepito'
    });

    var userModel = new UserModel({}, {
      configModel: configModel
    });

    el = document.createElement('div');
    el.id = 'wdmtmp';
    document.body.appendChild(el);
    var layersData = [{
      id: 'l-1',
      kind: 'carto',
      type: 'CartoDB',
      legends: [
        {
          type: 'bubble',
          title: 'My Bubble Legend',
          fill_color: '#FABADA'
        }
      ]
    }];
    var vizjson = {
      bounds: [[24.206889622398023, -84.0234375], [76.9206135182968, 169.1015625]],
      center: '[41.40578459184651, 2.2230148315429688]',
      user: {},
      datasource: {
        maps_api_template: 'asd',
        user_name: 'pepe'
      },
      layers: layersData,
      options: {
        scrollwheel: false
      },
      legends: true,
      widgets: []
    };

    spyOn($, 'ajax').and.callFake(function (options) {
      options.success({
        layergroupid: '123456789',
        metadata: {
          layers: []
        }
      });
    });

    spyOn(DeepInsightsIntegrations.prototype, '_getLayers').and.returnValue(new Backbone.Collection(vizjson.layers));

    deepInsights.createDashboard('#wdmtmp', vizjson, {
      autoStyle: true
    }, function (error, dashboard) {
      // Avoid HTTP requests setting img src to nothing
      dashboard._dashboard.dashboardView.$('img').attr('src', '');

      if (error) {
        throw new Error('error creating dashboard ' + error);
      }
      dashBoard = dashboard;

      this.analysis = dashBoard.getMap().analysis;
      spyOn(this.analysis, 'analyse').and.callThrough();

      this.editorModel = new Backbone.Model({
        settings: false
      });

      this.visDefinitionModel = new VisDefinitionModel({
        name: 'Foo Map',
        privacy: 'PUBLIC',
        updated_at: '2016-06-21T15:30:06+00:00',
        type: 'derived'
      }, {
        configModel: configModel
      });

      this.analysisDefinitionNodesCollection = new AnalysisDefinitionNodesCollection(null, {
        configModel: configModel,
        userModel: userModel
      });
      this.analysisDefinitionsCollection = new AnalysisDefinitionsCollection(null, {
        configModel: configModel,
        analysisDefinitionNodesCollection: this.analysisDefinitionNodesCollection,
        vizId: 'v-123',
        layerDefinitionsCollection: new Backbone.Collection()
      });

      this.stateDefinitionModel = new StateDefinitionModel({
        json: {
          map: {
            zoom: 10
          }
        }
      }, { visDefinitionModel: this.visDefinitionModel });
      spyOn(this.stateDefinitionModel, 'updateState');

      this.layerDefinitionsCollection = new LayerDefinitionsCollection(null, {
        configModel: configModel,
        userModel: userModel,
        analysisDefinitionNodesCollection: this.analysisDefinitionNodesCollection,
        mapId: 'map-123',
        stateDefinitionModel: this.stateDefinitionModel
      });

      this.layerDefinitionsCollection.resetByLayersData(layersData);

      this.mapDefinitionModel = new MapDefinitionModel({
        scrollwheel: false
      }, {
        parse: true,
        configModel: configModel,
        userModel: userModel,
        layerDefinitionsCollection: this.layerDefinitionsCollection
      });

      this.widgetDefinitionsCollection = new WidgetDefinitionsCollection(null, {
        configModel: configModel,
        mapId: 'map-123',
        layerDefinitionsCollection: this.layerDefinitionsCollection
      });

      this.legendDefinitionsCollection = new LegendDefinitionsCollection(null, {
        configModel: configModel,
        layerDefinitionsCollection: this.layerDefinitionsCollection,
        vizId: 'v-123'
      });

      spyOn(dashboard._dashboard.vis.map, 'setBounds');
      spyOn(dashboard, 'onStateChanged').and.callThrough();

      this.overlaysCollection = new Backbone.Collection();

      LegendFactory.init(this.legendDefinitionsCollection);

      var mapModeModel = new MapModeModel();

      this.integrations = new DeepInsightsIntegrations({
        userModel: new Backbone.Model(),
        onboardings: createOnboardings(),
        deepInsightsDashboard: dashboard,
        analysisDefinitionsCollection: this.analysisDefinitionsCollection,
        analysisDefinitionNodesCollection: this.analysisDefinitionNodesCollection,
        layerDefinitionsCollection: this.layerDefinitionsCollection,
        legendDefinitionsCollection: this.legendDefinitionsCollection,
        widgetDefinitionsCollection: this.widgetDefinitionsCollection,
        overlayDefinitionsCollection: this.overlaysCollection,
        stateDefinitionModel: this.stateDefinitionModel,
        visDefinitionModel: this.visDefinitionModel,
        mapDefinitionModel: this.mapDefinitionModel,
        editorModel: this.editorModel,
        mapModeModel: mapModeModel,
        configModel: configModel,
        editFeatureOverlay: new Backbone.View()
      });

      done();
    }.bind(this));
  });

  afterEach(function () {
    document.body.removeChild(el);
  });

  describe('time series', function () {
    var xhrSpy = jasmine.createSpyObj('xhr', ['abort', 'always', 'fail']);

    var cartocss = 'Map {-torque-frame-count: 256;-torque-animation-duration: 30;-torque-time-attribute: cartodb_id";-torque-aggregation-function: "count(1)";-torque-resolution: 4;-torque-data-aggregation: linear;} #layer {}, #layer[frame-offset=1] {marker-width: 9; marker-fill-opacity: 0.45;} #layer[frame-offset=2] {marker-width: 11; marker-fill-opacity: 0.225;}';

    var animatedChanged1 = {attribute: 'cartodb_id', duration: 24, overlap: false, resolution: 4, steps: 256, trails: 2};
    var animatedChanged2 = {attribute: 'cartodb_id', duration: 24, overlap: false, resolution: 4, steps: 256, trails: 3};

    beforeEach(function () {
      spyOn(Backbone.Model.prototype, 'sync').and.returnValue(xhrSpy);

      this.layerDefModel = new LayerDefinitionModel({
        id: 'wadus',
        kind: 'torque',
        options: {
          sql: 'SELECT * FROM fooo',
          table_name: 'fooo',
          cartocss: cartocss,
          // source: 'd0',
          style_properties: {
            type: 'animation',
            properties: {
              animated: {
                attribute: 'cartodb_id',
                duration: 30,
                overlap: false,
                resolution: 4,
                steps: 256,
                trails: 2
              }
            }
          }
        }
      }, { parse: true, configModel: 'c' });

      this.layerDefinitionsCollection.add(this.layerDefModel);

      this.d0 = this.analysisDefinitionNodesCollection.add({
        id: 'd0',
        type: 'source',
        params: {
          query: 'SELECT * FROM fooo'
        }
      });

      var nodeMod = this.analysis._analysisCollection.at(0);
      spyOn(nodeMod, 'isDone');
    });

    it('should create time-series widget on layer changes', function () {
      var l = this.integrations.visMap().layers.get(this.layerDefModel.id);
      spyOn(this.integrations, '_createTimeseries').and.callThrough();

      expect(l).toBeDefined();
      this.layerDefModel.styleModel.set({animated: animatedChanged1});
      this.layerDefModel.set({alias: 'wadus'});

      expect(this.integrations._createTimeseries).toHaveBeenCalled();
    });

    it('should create only one time-series widget', function () {
      spyOn(this.integrations, '_createTimeseries').and.callThrough();
      this.layerDefModel.styleModel.set({animated: animatedChanged1});
      this.layerDefModel.set({alias: 'wadus'});

      expect(this.integrations._createTimeseries).toHaveBeenCalled();

      Backbone.Model.prototype.sync.calls.argsFor(0)[2].error({
        error: 'abort'
      });

      this.layerDefModel.styleModel.set({animated: animatedChanged2});
      this.layerDefModel.set({alias: 'wadus wadus'});

      expect(this.integrations._createTimeseries).toHaveBeenCalled();

      Backbone.Model.prototype.sync.calls.argsFor(0)[2].success({
        id: '1',
        layer_id: 'wadus',
        options: {
          column: 'cartodb_id',
          bins: 256,
          animated: true,
          sync_on_data_change: true,
          sync_on_bbox_change: true
        },
        order: 0,
        source: {
          id: 'a0'
        },
        style: {
          widget_style: {
            definition: {
              color: {
                fixed: '#F2CC8F',
                opacity: 1
              }
            }
          }
        },
        title: 'time_date__t',
        type: 'time-series'
      });

      expect(this.widgetDefinitionsCollection.length).toBe(1);
    });
  });

  describe('_resetStylesIfNoneApplied', function () {
    beforeEach(function () {
      this.layerDefModel = new LayerDefinitionModel({
        id: 'harr',
        kind: 'carto',
        options: {
          sql: 'SELECT * FROM fooo',
          table_name: 'fooo',
          cartocss: '...',
          source: 'd1',
          style_properties: {
            type: 'none',
            properties: {}
          }
        }
      }, { parse: true, configModel: 'c' });
      this.layerDefinitionsCollection.add(this.layerDefModel, { silent: true });

      this.d0 = this.analysisDefinitionNodesCollection.add({
        id: 'd0',
        type: 'source',
        params: {
          query: 'SELECT * FROM foobar'
        }
      });

      this.d1 = this.analysisDefinitionsCollection.add({
        analysis_definition: {
          id: 'd1',
          type: 'buffer',
          params: {
            radius: 10,
            source: this.d0.toJSON()
          }
        }
      });

      var nodeMod = this.analysis._analysisCollection.at(1);
      spyOn(nodeMod, 'isDone');
      var nodeDef = this.layerDefModel.getAnalysisDefinitionNodeModel();
      nodeDef.queryGeometryModel.set('simple_geom', 'point', { silent: true });
      spyOn(this.layerDefModel.styleModel, 'setDefaultPropertiesByType').and.callThrough();
    });

    it('should not reset styles if layer doesn\'t have none styles', function () {
      this.layerDefModel.styleModel.set('type', 'simple', { silent: true });
      this.integrations._resetStylesIfNoneApplied(this.layerDefModel);
      expect(this.layerDefModel.styleModel.setDefaultPropertiesByType).not.toHaveBeenCalled();
    });

    it('should not reset styles if node definition has not finished', function () {
      var nodeMod = this.analysis._analysisCollection.at(1);
      nodeMod.isDone.and.returnValue(false);
      this.integrations._resetStylesIfNoneApplied(this.layerDefModel);
      expect(this.layerDefModel.styleModel.setDefaultPropertiesByType).not.toHaveBeenCalled();
    });

    it('should not reset styles if node type is source', function () {
      var nodeMod = this.analysis._analysisCollection.at(1);
      nodeMod.set('type', 'source');
      this.integrations._resetStylesIfNoneApplied(this.layerDefModel);
      expect(this.layerDefModel.styleModel.setDefaultPropertiesByType).not.toHaveBeenCalled();
    });

    it('should fetch geometry if it is not defined until reset styles', function () {
      var nodeDef = this.layerDefModel.getAnalysisDefinitionNodeModel();
      var nodeMod = this.analysis._analysisCollection.at(1);
      nodeDef.queryGeometryModel.set('simple_geom', '', { silent: true });
      nodeMod.isDone.and.returnValue(true);
      spyOn(nodeDef.queryGeometryModel, 'fetch').and.callFake(function () {
        nodeDef.queryGeometryModel.set('simple_geom', 'polygon', { silent: true });
      });

      this.integrations._resetStylesIfNoneApplied(this.layerDefModel);
      expect(nodeDef.queryGeometryModel.fetch).toHaveBeenCalled();
      expect(this.layerDefModel.styleModel.setDefaultPropertiesByType).not.toHaveBeenCalled();
    });

    it('should reset styles if layer has none styles', function () {
      var nodeMod = this.analysis._analysisCollection.at(1);
      nodeMod.isDone.and.returnValue(true);
      expect(this.layerDefModel.styleModel.hasNoneStyles()).toBeTruthy();
      this.integrations._resetStylesIfNoneApplied(this.layerDefModel);
      expect(this.layerDefModel.styleModel.setDefaultPropertiesByType).toHaveBeenCalled();
      expect(this.layerDefModel.styleModel.hasNoneStyles()).toBeFalsy();
    });
  });

  describe('when a widget-definition is created', function () {
    beforeEach(function () {
      spyOn(this.integrations, '_bindWidgetChanges').and.callThrough();
      spyOn(dashBoard, 'createFormulaWidget').and.callThrough();
      spyOn(WidgetsService, 'editWidget');
      spyOn(WidgetsService, 'removeWidget');

      this.model = this.widgetDefinitionsCollection.add({
        id: 'w-100',
        type: 'formula',
        title: 'avg of something',
        layer_id: 'l-1',
        source: {
          id: 'a0'
        },
        options: {
          column: 'col',
          operation: 'avg'
        }
      });
      this.model.trigger('sync', this.model);
    });

    afterEach(function () {
      // delete widget after test case
      this.widgetModel = dashBoard.getWidget(this.model.id);
      spyOn(this.widgetModel, 'remove').and.callThrough();

      // Fake deletion
      this.model.trigger('destroy', this.model);
      expect(this.widgetModel.remove).toHaveBeenCalled();
    });

    it('should bind widgets changes', function () {
      expect(this.integrations._bindWidgetChanges).toHaveBeenCalled();
    });

    it('should call widgets service properly', function () {
      var widget = dashBoard.getWidget(this.model.id);
      widget.trigger('editWidget', widget);
      expect(WidgetsService.editWidget).toHaveBeenCalled();

      widget.trigger('removeWidget', widget);
      expect(WidgetsService.removeWidget).toHaveBeenCalled();
    });

    it('should create the corresponding widget model for the dashboard', function () {
      expect(dashBoard.createFormulaWidget).toHaveBeenCalled();

      var args = dashBoard.createFormulaWidget.calls.argsFor(0);
      expect(args[0]).toEqual(jasmine.objectContaining({
        title: 'avg of something',
        layer_id: 'l-1',
        column: 'col',
        operation: 'avg',
        source: {id: 'a0'}
      }));
      expect(args[1]).toBe(this.integrations.visMap().layers.first());
    });

    it('should enable show_stats and show_options for the created widget model', function () {
      var widgetModel = dashBoard.getWidget(this.model.id);
      expect(widgetModel.get('show_stats')).toBeTruthy();
      expect(widgetModel.get('show_options')).toBeTruthy();
    });

    describe('when definition changes data', function () {
      beforeEach(function () {
        this.widgetModel = dashBoard.getWidget(this.model.id);
        spyOn(this.widgetModel, 'update').and.callThrough();
      });

      describe('of any normal param', function () {
        beforeEach(function () {
          this.model.set('operation', 'max');
        });

        it('should update the corresponding widget model', function () {
          expect(this.widgetModel.update).toHaveBeenCalled();
          expect(this.widgetModel.update).toHaveBeenCalledWith({ operation: 'max' });
        });
      });

      describe('of the source', function () {
        beforeEach(function () {
          this.model.set({
            operation: 'max',
            source: 'a1'
          });
        });

        it('should maintain normal params but massage the source', function () {
          expect(this.widgetModel.update).toHaveBeenCalled();
          expect(this.widgetModel.update).toHaveBeenCalledWith({
            operation: 'max',
            source: {id: 'a1'}
          });
        });
      });
    });

    describe('when definition changes type', function () {
      beforeEach(function () {
        this.widgetModel = dashBoard.getWidget(this.model.id);
        spyOn(this.widgetModel, 'remove').and.callThrough();
        spyOn(dashBoard, 'createCategoryWidget').and.callThrough();

        this.model.set('type', 'category');
      });

      it('should remove the corresponding widget model', function () {
        expect(this.widgetModel.remove).toHaveBeenCalled();
      });

      describe('should create a new widget model for the type', function () {
        beforeEach(function () {
          expect(dashBoard.createCategoryWidget).toHaveBeenCalled();
          // Same ceation flow as previously tested, so don't test more into detail for now
          expect(dashBoard.createCategoryWidget).toHaveBeenCalledWith(jasmine.any(Object), jasmine.any(Object));
        });

        it('with new attrs', function () {
          expect(dashBoard.createCategoryWidget.calls.argsFor(0)[0]).toEqual(
            jasmine.objectContaining({
              id: 'w-100',
              type: 'category',
              source: {id: 'a0'}
            })
          );
        });

        it('with prev layer-defintion', function () {
          expect(dashBoard.createCategoryWidget.calls.argsFor(0)[1].id).toEqual('l-1');
        });
      });

      it('should set show_stats in the new widget model', function () {
        var widgetModel = dashBoard.getWidget(this.model.id);
        expect(widgetModel.get('show_stats')).toBeTruthy();
      });
    });
  });

  describe('when a new layer definition model is created', function () {
    beforeEach(function () {
      this.layerDefinitionModel = this.layerDefinitionsCollection.add({
        id: 'integration-test',
        kind: 'carto',
        options: {
          sql: 'SELECT * FROM bar',
          cartocss: 'CARTO_CSS',
          table_name: 'bar',
          table_name_alias: 'My BAR'
        }
      }, { at: 1 }); // <- this is what actually determines the right order

      this.cartodbjsMap = this.integrations.visMap();
      spyOn(this.cartodbjsMap, 'createCartoDBLayer');
      spyOn(this.cartodbjsMap, 'createTorqueLayer');

      this.cdbjsLayer = new Backbone.Model();
      this.cdbjsLayer.update = jasmine.createSpy('update');
      this.cdbjsLayer.remove = jasmine.createSpy('remove');

      this.integrations.visMap().getLayerById = function (layerId) {
        if (layerId === 'integration-test') {
          return this.cdbjsLayer;
        }
      }.bind(this);
    });

    it('should create the CartoDB.js layer at the given position (order)', function () {
      this.layerDefinitionModel = this.layerDefinitionsCollection.add({
        id: 'integration-test-2',
        kind: 'carto',
        options: {
          sql: 'SELECT * FROM foo',
          cartocss: 'CARTO_CSS'
        }
      }, { at: 1 }); // <- this is what actually determines the right order

      expect(this.cartodbjsMap.createCartoDBLayer).toHaveBeenCalledWith({
        id: 'integration-test-2',
        sql: 'SELECT * FROM foo',
        cartocss: 'CARTO_CSS',
        order: 1,
        type: 'CartoDB'
      }, {
        at: 1
      });
    });

    it('should update the CartoDB.js layer at the right position', function () {
      var collection = new Backbone.Collection([new Backbone.Model(), this.cdbjsLayer, new Backbone.Model(), new Backbone.Model()]);
      spyOn(this.integrations.visMap(), 'moveCartoDBLayer');
      this.integrations._getLayers.and.returnValue(collection);
      spyOn(this.integrations, '_getLayer').and.returnValue(this.cdbjsLayer);

      this.layerDefinitionsCollection.remove(this.layerDefinitionModel);

      this.layerDefinitionsCollection.add({
        id: 'integration-test-2',
        kind: 'carto',
        options: {
          sql: 'SELECT * FROM foo',
          cartocss: 'CARTO_CSS'
        }
      }, { at: 1 });

      this.layerDefinitionsCollection.add(this.layerDefinitionModel, { at: 2 });

      expect(this.integrations.visMap().moveCartoDBLayer).toHaveBeenCalledWith(1, 2);
    });

    describe('when the layer definition model is updated', function () {
      beforeEach(function () {
        this.layerDefinitionModel.set({
          sql: 'SELECT * FROM bar LIMIT 10',
          cartocss: 'NEW_CARTO_CSS'
        });
      });

      it('should update the CartoDB.js layer', function () {
        expect(this.cdbjsLayer.update).toHaveBeenCalledWith({
          sql: 'SELECT * FROM bar LIMIT 10',
          cartocss: 'NEW_CARTO_CSS',
          source: 'b0'
        });
      });
    });

    describe('when layer type is changed to torque', function () {
      beforeEach(function () {
        this.layerDefinitionModel.set('type', 'torque');
      });

      it('should have re-created the layer', function () {
        expect(this.cdbjsLayer.remove).toHaveBeenCalled();
        expect(this.cartodbjsMap.createTorqueLayer).toHaveBeenCalledWith({
          id: 'integration-test',
          sql: 'SELECT * FROM bar',
          cartocss: 'CARTO_CSS',
          table_name: 'bar',
          table_name_alias: 'My BAR',
          autoStyle: false,
          order: 1,
          source: 'b0',
          type: 'torque',
          layer_name: 'My BAR'
        }, { at: 1 });
      });

      xit("should have created a timeslider widget if there wasn't one", function () {
        expect(this.widgetDefinitionsCollection.where({'type': 'time-series'}).length).not.toBeLessThan(1);
      });
    });

    describe('when layer has a source attribute here and not in CartoDB.js', function () {
      it('should set/update the source attribute', function () {
        // Imagine CartoDB.js returns a layer with no source
        this.cdbjsLayer.set({
          'id': 'integration-test',
          'type': 'CartoDB',
          'order': 1,
          'visible': true,
          'cartocss': 'cartoCSS',
          'cartocss_version': '2.1.1',
          'sql': 'SELECT * FROM test'
        });

        // Change some attributes in the definition model
        this.cdbjsLayer.update.calls.reset();
        this.layerDefinitionModel.set({
          cartocss: 'a different CartoCSS'
        });

        // The CartoDB.js layer has been updated and given a source
        expect(this.cdbjsLayer.update).toHaveBeenCalledWith({
          cartocss: 'a different CartoCSS',
          source: this.layerDefinitionModel.get('source')
        });
      });
    });

    describe('when removing layer', function () {
      beforeEach(function () {
        this.layerDefinitionsCollection.remove(this.layerDefinitionModel);
      });

      it('cartodb.js layer should be removed too', function () {
        expect(this.cdbjsLayer.remove).toHaveBeenCalled();
      });
    });
  });

  describe('when the base layer has changed', function () {
    beforeEach(function () {
      this.layerDefinitionsCollection.reset([
        {
          order: 0,
          id: 'layer-id',
          type: 'Tiled',
          default: true,
          urlTemplate: 'http://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
          subdomains: 'abcd',
          minZoom: '0',
          maxZoom: '18',
          name: 'Positron',
          className: 'positron_rainbow_labels',
          attribution: '© <a href=\'http://www.openstreetmap.org/copyright\'>OpenStreetMap</a> contributors © <a href=\'https://carto.com/attributions\'>CARTO</a>'
        }
      ], { parse: false });

      this.cdbjsMap = this.integrations.visMap();
      spyOn(this.cdbjsMap, 'set');
      spyOn(this.cdbjsMap, 'createTileLayer');
      spyOn(this.cdbjsMap, 'createPlainLayer');
      spyOn(this.cdbjsMap, 'createGMapsBaseLayer');

      this.cdbjsLayer = new Backbone.Model();
      this.cdbjsLayer.update = jasmine.createSpy('update');
      this.cdbjsLayer.remove = jasmine.createSpy('remove');

      spyOn(this.cdbjsMap.layers, 'get').and.returnValue(this.cdbjsLayer);
    });

    it('should re-create the cdb.js layer if type has changed', function () {
      this.layerDefinitionsCollection.at(0).attributes = _.pick(this.layerDefinitionsCollection.attributes, 'type');
      this.layerDefinitionsCollection.at(0).set({
        id: 'baseLayer',
        type: 'Plain',
        color: '#FABADA',
        order: 0
      });

      this.layerDefinitionsCollection.trigger('baseLayerChanged');
      expect(this.cdbjsLayer.remove).toHaveBeenCalled();
      expect(this.cdbjsMap.createPlainLayer).toHaveBeenCalledWith({
        id: 'baseLayer',
        type: 'Plain',
        color: '#FABADA',
        order: 0
      }, { at: 0, silent: false });
    });

    it('should update the cdb.js layer if type has NOT changed', function () {
      this.layerDefinitionsCollection.at(0).set({
        urlTemplate: 'newURLTemplate'
      });

      this.layerDefinitionsCollection.trigger('baseLayerChanged');

      expect(this.cdbjsLayer.update).toHaveBeenCalledWith({
        urlTemplate: 'newURLTemplate'
      }, { silent: false });
    });

    it('should change the map provider', function () {
      this.layerDefinitionsCollection.at(0).attributes = _.pick(this.layerDefinitionsCollection.attributes, 'type');
      this.layerDefinitionsCollection.at(0).set({
        name: 'GMaps Hybrid',
        maxZoom: 40,
        minZoom: 0,
        baseType: 'hybrid',
        className: 'googlemaps',
        style: '[]',
        type: 'GMapsBase'
      });

      this.layerDefinitionsCollection.trigger('baseLayerChanged');

      expect(this.cdbjsMap.set).toHaveBeenCalledWith('provider', 'googlemaps');
    });

    describe('if new new base layer has labels', function () {
      beforeEach(function () {
        this.layerDefinitionsCollection.resetByLayersData([
          {
            'id': 'baseLayer',
            'options': {
              'type': 'Tiled',
              'urlTemplate': 'urlTemplate'
            },
            'kind': 'tiled',
            'order': 0
          },
          {
            'id': 'labelsLayer',
            'options': {
              'type': 'Tiled',
              'urlTemplate': 'urlTemplate2'
            },
            'kind': 'tiled',
            'order': 1
          }
        ]);

        this.cdbjsLayer = new Backbone.Model({ id: 'baseLayer' });
        this.cdbjsLayer.update = jasmine.createSpy('update');
        this.cdbjsLayer.remove = jasmine.createSpy('remove');
      });

      describe('if cdb.js has a layer with labels', function () {
        beforeEach(function () {
          this.cdbjsLabelsLayer = new Backbone.Model({ type: 'Tiled' });
          this.cdbjsLabelsLayer.update = jasmine.createSpy('update');
          this.cdbjsLabelsLayer.remove = jasmine.createSpy('remove');

          this.integrations._getLayers.and.returnValue(new Backbone.Collection([
            this.cdbjsLayer,
            this.cdbjsLabelsLayer
          ]));

          this.integrations.visMap().getLayerById = function (layerId) {
            if (this.layerDefinitionsCollection.at(0).id === layerId) {
              return this.cdbjsLayer;
            }
            if (this.layerDefinitionsCollection.at(1).id === layerId) {
              return this.cdbjsLabelsLayer;
            }
          }.bind(this);
        });

        it('should update the cdb.js labels layer when something changes', function () {
          this.layerDefinitionsCollection.at(1).set({
            urlTemplate: 'urlTemplate3'
          });
          this.layerDefinitionsCollection.trigger('baseLayerChanged');

          expect(this.cdbjsLabelsLayer.update).toHaveBeenCalledWith({
            urlTemplate: 'urlTemplate3'
          }, { silent: false });
        });
      });

      describe('if cdb.js does NOT have a layer with labels', function () {
        beforeEach(function () {
          this.integrations._getLayers.and.returnValue(new Backbone.Collection([
            this.cdbjsLayer
          ]));

          this.integrations.visMap().getLayerById = function (layerId) {
            if (this.layerDefinitionsCollection.at(0).id === layerId) {
              return this.cdbjsLayer;
            }
          }.bind(this);
        });

        it('should create the cdb.js labels layer', function () {
          this.layerDefinitionsCollection.trigger('baseLayerChanged');

          expect(this.cdbjsMap.createTileLayer).toHaveBeenCalledWith({
            id: 'labelsLayer',
            order: 1,
            type: 'Tiled',
            urlTemplate: 'urlTemplate2'
          }, { at: 1, silent: false });
        });
      });
    });

    describe('if new new base layer does NOT have labels', function () {
      beforeEach(function () {
        this.layerDefinitionsCollection.resetByLayersData([
          {
            'id': 'baseLayer',
            'options': {
              'type': 'Tiled',
              'urlTemplate': 'urlTemplate'
            },
            'kind': 'tiled',
            'order': 0
          }
        ]);

        this.cdbjsLayer = new Backbone.Model({ id: 'baseLayer' });
        this.cdbjsLayer.update = jasmine.createSpy('update');
        this.cdbjsLayer.remove = jasmine.createSpy('remove');
      });

      describe('if cdb.js has a layer with labels', function () {
        beforeEach(function () {
          this.cdbjsLabelsLayer = new Backbone.Model({ type: 'Tiled' });
          this.cdbjsLabelsLayer.update = jasmine.createSpy('update');
          this.cdbjsLabelsLayer.remove = jasmine.createSpy('remove');

          this.integrations._getLayers.and.returnValue(new Backbone.Collection([
            this.cdbjsLayer,
            this.cdbjsLabelsLayer
          ]));

          this.integrations.visMap().getLayerById = function (layerId) {
            if (this.layerDefinitionsCollection.at(0).id === layerId) {
              return this.cdbjsLayer;
            }
            if (this.layerDefinitionsCollection.at(1).id === layerId) {
              return this.cdbjsLabelsLayer;
            }
          }.bind(this);
        });

        it('should remove the cdb.js labels layer', function () {
          this.layerDefinitionsCollection.trigger('baseLayerChanged');

          expect(this.cdbjsLabelsLayer.remove).toHaveBeenCalledWith({ silent: false });
        });
      });
    });
  });

  describe('scrollwheel', function () {
    it('when activating scrollwheel', function () {
      var map = this.integrations.visMap();
      spyOn(map, 'enableScrollWheel');
      spyOn(map, 'disableScrollWheel');

      this.mapDefinitionModel.set({scrollwheel: !this.mapDefinitionModel.get('scrollwheel')});
      this.mapDefinitionModel.set({scrollwheel: !this.mapDefinitionModel.get('scrollwheel')});

      expect(map.enableScrollWheel).toHaveBeenCalled();
      expect(map.disableScrollWheel).toHaveBeenCalled();
    });
  });

  describe('legends', function () {
    it('when activating legends', function () {
      var vis = this.integrations._vis();

      this.mapDefinitionModel.set({legends: true});
      expect(vis.settings.get('showLegends')).toBe(true);
      this.mapDefinitionModel.set({legends: false});
      expect(vis.settings.get('showLegends')).toBe(false);
    });
  });

  describe('when the style is changed', function () {
    it("should disable any activated widgets' autoStyle", function () {
      this.a0 = this.analysisDefinitionNodesCollection.add({
        id: 'a0',
        type: 'source',
        params: {
          query: 'SELECT * FROM foobar'
        }
      });

      var layerDefinitionModel = this.layerDefinitionsCollection.add({
        id: 'integration-test',
        kind: 'carto',
        options: {
          table_name: 'something',
          source: 'a0',
          cartocss: ''
        }
      });

      var nodeDef = layerDefinitionModel.getAnalysisDefinitionNodeModel();
      nodeDef.queryGeometryModel.set('simple_geom', 'point');
      spyOn(layerDefinitionModel, 'save');

      var model = this.widgetDefinitionsCollection.add({
        id: 'w-100',
        type: 'category',
        title: 'test',
        layer_id: 'integration-test',
        options: {
          column: 'col'
        },
        source: {
          id: 'a0'
        }
      });
      model.trigger('sync', model);
      var widgetModel = dashBoard.getWidgets()[0];
      widgetModel.set('autoStyle', true);
      layerDefinitionModel.set('cartocss', 'differentCartocss');
      document.body.removeChild(document.getElementsByClassName('CDB-Widget-tooltip')[0]);
      expect(widgetModel.get('autoStyle')).toBe(false);
    });
  });

  describe('autoStyle', function () {
    var category;
    var histogram;
    var layerDefinitionModel;
    var nodeDefinitionModel;
    var originalAjax;

    beforeEach(function () {
      originalAjax = Backbone.ajax;
      Backbone.ajax = function () {
        return {
          always: function (cb) {
            cb();
          }
        };
      };

      this.a0 = this.analysisDefinitionNodesCollection.add({
        id: 'a0',
        type: 'source',
        params: {
          query: 'SELECT * FROM foobar'
        }
      });

      layerDefinitionModel = this.layerDefinitionsCollection.add({
        id: 'integration-test',
        kind: 'carto',
        options: {
          table_name: 'something',
          source: 'a0',
          cartocss: ''
        }
      });

      spyOn(layerDefinitionModel.styleModel, 'resetPropertiesFromAutoStyle').and.callThrough();
      spyOn(layerDefinitionModel.styleModel, 'setPropertiesFromAutoStyle').and.callThrough();

      nodeDefinitionModel = layerDefinitionModel.getAnalysisDefinitionNodeModel();
      nodeDefinitionModel.set('simple_geom', 'point');

      category = this.widgetDefinitionsCollection.add({
        id: 'as1',
        type: 'category',
        title: 'category',
        layer_id: 'integration-test',
        options: {
          column: 'col'
        },
        source: {
          id: 'a0'
        }
      });
      category.trigger('sync', category);

      histogram = this.widgetDefinitionsCollection.add({
        id: 'as2',
        type: 'histogram',
        title: 'histogram',
        layer_id: 'integration-test',
        options: {
          column: 'col'
        },
        source: {
          id: 'a0'
        }
      });
      histogram.trigger('sync', histogram);
    });

    afterEach(function () {
      Backbone.ajax = originalAjax;
      category.trigger('destroy', category);
      histogram.trigger('destroy', category);

      var nodes = document.querySelectorAll('.CDB-Widget-tooltip');
      [].slice.call(nodes).forEach(function (node) {
        var parent = node.parentNode;
        parent.removeChild(node);
      });
    });

    it('should cancel autostyle on remove widget', function () {
      var model = dashBoard.getWidget(category.id);
      spyOn(model, 'cancelAutoStyle');
      model.set({autoStyle: true});

      category.trigger('destroy', category);
      expect(model.cancelAutoStyle).toHaveBeenCalled();
    });

    it('should update layer definition model\'s autostyle properly', function () {
      var model = dashBoard.getWidget(category.id);
      model.set({autoStyle: true});
      expect(layerDefinitionModel.get('autoStyle')).toBe(model.id);
      expect(layerDefinitionModel.styleModel.setPropertiesFromAutoStyle).toHaveBeenCalled();

      model.set({autoStyle: false});
      expect(layerDefinitionModel.get('autoStyle')).toBe(false);
      expect(layerDefinitionModel.styleModel.resetPropertiesFromAutoStyle).toHaveBeenCalled();
    });

    it('should update layer definition model\'s style properly based on previous custom style', function () {
      var css = '#layer { marker-width: 5; marker-fill: red; marker-fill-opacity: 1; marker-line-width: 1; marker-line-color: #ff0e0e; marker-line-opacity: 1; }';
      var model = dashBoard.getWidget(category.id);

      model.set({ autoStyle: true });

      expect(layerDefinitionModel.get('cartocss_custom')).toBe(false);

      layerDefinitionModel.set({
        previousCartoCSSCustom: true,
        previousCartoCSS: css
      });

      model.set({ autoStyle: false });

      expect(layerDefinitionModel.get('cartocss_custom')).toBe(true);
      expect(layerDefinitionModel.get('cartocss')).toBe(css);
    });

    it('should update layer definition model\'s color properly', function () {
      var model = dashBoard.getWidget(category.id);
      model.set({autoStyle: true}, {silent: true});
      model.set({color: '#fabada'});
      expect(layerDefinitionModel.get('autoStyle')).toBe(model.id);
      expect(layerDefinitionModel.styleModel.setPropertiesFromAutoStyle).toHaveBeenCalled();

      layerDefinitionModel.styleModel.setPropertiesFromAutoStyle.calls.reset();

      model.set({autoStyle: false}, {silent: true});
      model.set({color: '#f4b4d4'});
      expect(layerDefinitionModel.get('autoStyle')).toBe(false);
      expect(layerDefinitionModel.styleModel.setPropertiesFromAutoStyle).not.toHaveBeenCalled();
    });

    it('should disable autoStyle if aggregation is not simple', function () {
      var model = dashBoard.getWidget(category.id);
      model.set({autoStyle: true});
      expect(layerDefinitionModel.get('autoStyle')).toBe(model.id);
      expect(layerDefinitionModel.styleModel.setPropertiesFromAutoStyle).toHaveBeenCalled();

      layerDefinitionModel.styleModel.set({type: 'squares'});
      layerDefinitionModel.save();

      expect(layerDefinitionModel.get('autoStyle')).toBe(false);
      expect(model.get('autoStyle')).toBe(false);
    });
  });

  describe('when analysis-definition-node is created', function () {
    beforeEach(function () {
      this.a0 = this.analysisDefinitionNodesCollection.add({
        id: 'a0',
        type: 'source',
        params: {
          query: 'SELECT * FROM foobar'
        }
      });
    });

    it('should analyse node', function () {
      expect(this.analysis.analyse).toHaveBeenCalledWith({
        id: 'a0',
        type: 'source',
        params: {
          query: 'SELECT * FROM foobar'
        }
      });
    });

    describe('when changed', function () {
      beforeEach(function () {
        this.analysis.analyse.calls.reset();
        this.a0.set('query', 'SELECT * FROM foobar LIMIT 10');
      });

      it('should analyse node again but with changed query', function () {
        expect(this.analysis.analyse).toHaveBeenCalled();
        expect(this.analysis.analyse).toHaveBeenCalledWith(
          jasmine.objectContaining({
            params: {
              query: 'SELECT * FROM foobar LIMIT 10'
            }
          })
        );
      });
    });

    describe('when changed only id', function () {
      beforeEach(function () {
        this.analysis.analyse.calls.reset();
        this.a0.set('id', 'b0');
      });

      it('should not analyse node', function () {
        expect(this.analysis.analyse).not.toHaveBeenCalled();
      });

      it('should change the node id in CARTO.js', function () {
        expect(this.analysis.findNodeById('b0')).toBeDefined();
        expect(this.analysis.findNodeById('a0')).not.toBeDefined();
      });
    });

    describe('when changed id and another thing', function () {
      beforeEach(function () {
        this.analysis.analyse.calls.reset();
        this.a0.set({
          id: 'b0',
          query: 'SELECT * FROM whatever'
        });
      });

      it('should analyse node', function () {
        expect(this.analysis.analyse).toHaveBeenCalled();
      });

      it('should change the node id in CARTO.js', function () {
        expect(this.analysis.findNodeById('b0')).toBeDefined();
        expect(this.analysis.findNodeById('a0')).toBeDefined();
      });
    });

    describe('when an analysis-definition is added for source node', function () {
      beforeEach(function () {
        spyOn(this.a0.querySchemaModel, 'set');
        this.analysisDefinitionsCollection.add({analysis_definition: this.a0.toJSON()});
      });

      it('should setup sub-models of node-definition', function () {
        expect(this.a0.querySchemaModel.get('query')).toEqual('SELECT * FROM foobar');
        expect(this.a0.queryGeometryModel.get('query')).toBe('SELECT * FROM foobar');
        expect(this.a0.queryGeometryModel.get('ready')).toBe(true);
      });

      describe('when analysis node has finished executing', function () {
        beforeEach(function () {
          this.analysis.findNodeById('a0').set('status', 'ready');
        });

        it('should not affect the query-schema-model if its a source', function () {
          expect(this.a0.querySchemaModel.set).not.toHaveBeenCalled();
        });
      });

      describe('when analysis-definition-node is removed', function () {
        beforeEach(function () {
          expect(this.analysis.findNodeById('a0')).toBeDefined();
          this.analysisDefinitionNodesCollection.remove(this.a0);
        });

        it('should remove node', function () {
          expect(this.analysis.findNodeById('a0')).toBeUndefined();
        });
      });
    });

    describe('when an analysis definition is added for non-source node', function () {
      beforeEach(function () {
        this.analysisDefinitionsCollection.add({
          analysis_definition: {
            id: 'a1',
            type: 'buffer',
            params: {
              radius: 10,
              source: this.a0.toJSON()
            }
          }
        });
        this.a1 = this.analysisDefinitionNodesCollection.get('a1');
      });

      it('should setup sub-models of node-definition', function () {
        expect(this.a1.querySchemaModel.get('query')).toEqual(undefined);
        expect(this.a1.queryGeometryModel.get('query')).toEqual(undefined);
        expect(this.a1.queryGeometryModel.get('ready')).toBe(false);
      });

      describe('when analysis node has finished executing', function () {
        beforeEach(function () {
          this.node = this.analysisDefinitionNodesCollection.get('a1');
          this.node.USER_SAVED = true;
          this.analysis.findNodeById('a1').set({
            query: 'SELECT buffer FROM tmp_result_table_123',
            status: 'ready'
          });
        });

        it('should launch the onboarding analysis if the user saved the node', function () {
          expect(AnalysisOnboardingLauncher.launch).toHaveBeenCalled();
          expect(this.node.USER_SAVED).toBeFalsy();
        });
      });

      describe('when analysis node has finished executing', function () {
        beforeEach(function () {
          this.analysis.findNodeById('a1').set({
            query: 'SELECT buffer FROM tmp_result_table_123',
            status: 'ready'
          });
        });

        it('should update the sub-models', function () {
          expect(this.a1.querySchemaModel.get('query')).toEqual('SELECT buffer FROM tmp_result_table_123');
          expect(this.a1.queryGeometryModel.get('query')).toEqual('SELECT buffer FROM tmp_result_table_123');
          expect(this.a1.queryGeometryModel.get('ready')).toBe(true);
        });
      });
    });
  });

  describe('when a layer is moved', function () {
    it('should invoke moveCartoDBLayer function in CartoDB.js', function () {
      spyOn(this.integrations.visMap(), 'moveCartoDBLayer');
      this.layerDefinitionsCollection.trigger('layerMoved', this.layerDefinitionsCollection.at(0), 0, 1);
      expect(this.integrations.visMap().moveCartoDBLayer).toHaveBeenCalledWith(0, 1);
    });
  });

  describe('when vis reloads', function () {
    it('should increment changes', function () {
      this.integrations._vis().trigger('reload');
      expect(this.visDefinitionModel.get('visChanges')).toBe(1);
    });
  });

  it('mapViewSizeChanged', function () {
    var map = this.integrations.visMap();
    spyOn(map, 'getMapViewSize').and.returnValue({
      x: 120,
      y: 133
    });

    spyOn(this.mapDefinitionModel, 'setMapViewSize').and.callThrough();

    map.trigger('mapViewSizeChanged');
    expect(this.mapDefinitionModel.setMapViewSize).toHaveBeenCalled();
    expect(this.mapDefinitionModel.getMapViewSize()).toEqual({
      x: 120,
      y: 133
    });
  });

  it('should set converters when basemap changes', function () {
    spyOn(this.mapDefinitionModel, 'setConverters');

    this.layerDefinitionsCollection.trigger('baseLayerChanged');
    expect(this.mapDefinitionModel.setConverters).toHaveBeenCalled();
  });

  describe('visMetadata', function () {
    beforeEach(function () {
      spyOn(this.mapDefinitionModel, 'setImageExportMetadata');
      spyOn(this.mapDefinitionModel, 'setStaticImageURLTemplate');
    });

    it('should update vis metadata when state changes', function () {
      this.integrations._diDashboard._dashboard.vis.trigger('dataviewsFetched');
      this.integrations.visMap().set('center', [10, 20]);
      expect(this.mapDefinitionModel.setImageExportMetadata).toHaveBeenCalled();
      expect(this.mapDefinitionModel.setStaticImageURLTemplate).toHaveBeenCalled();
    });

    it('update vis metadata when vis reload', function () {
      this.integrations._vis().trigger('reload');
      expect(this.mapDefinitionModel.setImageExportMetadata).toHaveBeenCalled();
      expect(this.mapDefinitionModel.setStaticImageURLTemplate).toHaveBeenCalled();
    });
  });

  describe('.infowindow', function () {
    beforeEach(function () {
      this.cdbLayer = createFakeLayer({ id: 'layer-id' });
      this.cdbLayer.infowindow = jasmine.createSpyObj('infowindow', ['update']);

      this.layerDefinitionsCollection.resetByLayersData({
        id: 'layer-id',
        kind: 'carto',
        options: {
          table_name: 'infowindow_stuff',
          cartocss: ''
        },
        infowindow: {
          alternative_names: {},
          autoPan: true,
          content: '',
          fields: [],
          headerColor: {},
          latlng: [0, 0],
          maxHeight: 180,
          offset: [28, 0],
          template: '',
          template_name: 'table/views/infowindow_light',
          visibility: false,
          width: 226
        }
      });

      spyOn(DeepInsightsIntegrations.prototype, '_onLegendDefinitionAdded');

      var mapModeModel = new MapModeModel();
      var configModel = new ConfigModel({
        base_url: 'pepito'
      });

      this.integrations2 = new DeepInsightsIntegrations({
        userModel: new Backbone.Model(),
        onboardings: createOnboardings(),
        deepInsightsDashboard: createFakeDashboard([ this.cdbLayer ]),
        analysisDefinitionsCollection: this.analysisDefinitionsCollection,
        analysisDefinitionNodesCollection: this.analysisDefinitionNodesCollection,
        layerDefinitionsCollection: this.layerDefinitionsCollection,
        legendDefinitionsCollection: this.legendDefinitionsCollection,
        widgetDefinitionsCollection: this.widgetDefinitionsCollection,
        stateDefinitionModel: this.stateDefinitionModel,
        overlayDefinitionsCollection: this.overlaysCollection,
        visDefinitionModel: this.visDefinitionModel,
        mapDefinitionModel: this.mapDefinitionModel,
        editorModel: this.editorModel,
        mapModeModel: mapModeModel,
        configModel: configModel,
        editFeatureOverlay: new Backbone.View()
      });
    });

    it('should not show infowindow', function () {
      expect(this.cdbLayer.infowindow.update).toHaveBeenCalledWith({
        alternative_names: {},
        autoPan: true,
        content: '',
        fields: [],
        headerColor: {},
        latlng: [0, 0],
        maxHeight: 180,
        offset: [28, 0],
        template: '',
        template_name: 'table/views/infowindow_light',
        visibility: false,
        width: 226
      });
    });

    describe('w/o fields', function () {
      beforeEach(function () {
        this.cdbLayer.infowindow.update.calls.reset();
        this.cdbLayer.infowindow = jasmine.createSpyObj('infowindow', ['update']);
      });

      describe('when template is changed', function () {
        beforeEach(function () {
          this.layerDefinitionsCollection.at(0).infowindowModel.set({
            'template_name': 'infowindow_light',
            'template': '<div class="CDB-infowindow"></div>'
          });
        });

        xit('should set a "none" template', function () {
          expect(this.cdbLayer.infowindow.update).toHaveBeenCalledWith({
            alternative_names: {},
            autoPan: true,
            content: '',
            fields: [{ name: 'cartodb_id', title: true, position: 0 }],
            headerColor: {},
            latlng: [0, 0],
            maxHeight: 180,
            offset: [28, 0],
            template: '<div class="CDB-infowindow Infowindow-none js-infowindow">\n  <div class="CDB-infowindow-close js-close"></div>\n  <div class="CDB-infowindow-container">\n    <div class="CDB-infowindow-bg">\n      <div class="CDB-infowindow-inner">\n        {{#loading}}\n          <div class="CDB-Loader js-loader is-visible"></div>\n        {{/loading}}\n        <ul class="CDB-infowindow-list">\n          <li class="CDB-infowindow-listItem">\n            <h5 class="CDB-infowindow-subtitle">Select fields</h5>\n            <h4 class="CDB-infowindow-title">You haven’t selected any fields to be shown in the infowindow.</h4>\n          </li>\n        </ul>\n      </div>\n    </div>\n    <div class="CDB-hook">\n      <div class="CDB-hook-inner"></div>\n    </div>\n  </div>\n</div>\n',
            template_name: 'infowindow_light',
            visibility: false,
            width: 226
          });
        });
      });
    });

    describe('w/ fields', function () {
      beforeEach(function () {
        this.layerDefinitionsCollection.at(0).infowindowModel.set({
          'fields': [
            {
              name: 'description',
              title: true,
              position: 0
            },
            {
              name: 'name',
              title: true,
              position: 1
            }
          ]
        });

        this.cdbLayer.infowindow.update.calls.reset();
        this.cdbLayer.infowindow = jasmine.createSpyObj('infowindow', ['update']);
      });

      describe('when template is changed', function () {
        beforeEach(function () {
          this.layerDefinitionsCollection.at(0).infowindowModel.set({
            'template_name': 'infowindow_light',
            'template': '<div class="CDB-infowindow"></div>'
          });
        });

        it('should update template', function () {
          expect(this.cdbLayer.infowindow.update).toHaveBeenCalledWith({
            alternative_names: {},
            autoPan: true,
            content: '',
            fields: [
              {
                name: 'description',
                title: true,
                position: 0
              },
              {
                name: 'name',
                title: true,
                position: 1
              }
            ],
            headerColor: {},
            latlng: [0, 0],
            maxHeight: 180,
            offset: [28, 0],
            template_name: 'infowindow_light',
            template: '<div class="CDB-infowindow"></div>',
            visibility: false,
            width: 226
          });
        });
      });

      describe('when both template and fields are changed', function () {
        beforeEach(function () {
          this.layerDefinitionsCollection.at(0).infowindowModel.set({
            'fields': [
              {
                name: 'description',
                title: true,
                position: 1
              },
              {
                name: 'name',
                title: true,
                position: 0
              }
            ],
            'template_name': 'infowindow_dark',
            'template': '<div class="CDB-infowindow CDB-infowindow--dark"></div>'
          });
        });

        it('should update fields and template', function () {
          expect(this.cdbLayer.infowindow.update).toHaveBeenCalledWith({
            alternative_names: {},
            autoPan: true,
            content: '',
            fields: [
              {
                name: 'description',
                title: true,
                position: 1
              },
              {
                name: 'name',
                title: true,
                position: 0
              }
            ],
            headerColor: {},
            latlng: [0, 0],
            maxHeight: 180,
            offset: [28, 0],
            template: '<div class="CDB-infowindow CDB-infowindow--dark"></div>',
            template_name: 'infowindow_dark',
            visibility: false,
            width: 226
          });
        });
      });
    });
  });

  describe('"syncing" of errors coming from cartodb.js models', function () {
    beforeEach(function () {
      this.cdbLayer = createFakeLayer({
        id: 'layer-id',
        error: {
          type: 'turbo-carto',
          context: {
            source: {
              start: {
                line: 99
              }
            }
          },
          message: 'something went wrong'
        }
      });
      this.cdbLayer.infowindow = jasmine.createSpyObj('infowindow', ['update']);

      this.layerDefinitionsCollection.resetByLayersData({
        id: 'layer-id',
        kind: 'carto',
        options: {
          table_name: 'infowindow_stuff',
          cartocss: ''
        },
        infowindow: {
          alternative_names: {},
          autoPan: true,
          content: '',
          fields: [],
          headerColor: {},
          latlng: [0, 0],
          maxHeight: 180,
          offset: [28, 0],
          template: '',
          template_name: 'table/views/infowindow_light',
          visibility: false,
          width: 226
        }
      });

      spyOn(DeepInsightsIntegrations.prototype, '_onLegendDefinitionAdded');

      var mapModeModel = new MapModeModel();
      var configModel = new ConfigModel({
        base_url: 'pepito'
      });

      this.integrations2 = new DeepInsightsIntegrations({
        userModel: new Backbone.Model(),
        onboardings: createOnboardings(),
        deepInsightsDashboard: createFakeDashboard([ this.cdbLayer ]),
        analysisDefinitionsCollection: this.analysisDefinitionsCollection,
        analysisDefinitionNodesCollection: this.analysisDefinitionNodesCollection,
        layerDefinitionsCollection: this.layerDefinitionsCollection,
        legendDefinitionsCollection: this.legendDefinitionsCollection,
        widgetDefinitionsCollection: this.widgetDefinitionsCollection,
        stateDefinitionModel: this.stateDefinitionModel,
        overlayDefinitionsCollection: this.overlaysCollection,
        visDefinitionModel: this.visDefinitionModel,
        mapDefinitionModel: this.mapDefinitionModel,
        editorModel: this.editorModel,
        mapModeModel: mapModeModel,
        configModel: configModel,
        editFeatureOverlay: new Backbone.View()
      });
    });

    it('should set turbo-carto errors on the layerDefinitionModel if CartoDB.js layer had an error', function () {
      expect(this.layerDefinitionsCollection.at(0).get('error')).toEqual({
        type: 'turbo-carto',
        line: 99,
        message: 'something went wrong'
      });
    });

    it('should set turbo-carto errors on the layerDefinitionModel if CartoDB.js layer gets new errors', function () {
      this.cdbLayer.set('error', {
        type: 'turbo-carto',
        context: {
          source: {
            start: {
              line: 199
            }
          }
        },
        message: 'something went totally wrong'
      });

      expect(this.layerDefinitionsCollection.at(0).get('error')).toEqual({
        type: 'turbo-carto',
        line: 199,
        message: 'something went totally wrong'
      });
    });

    it('should add an error in the notifier with the same id as the layer', function () {
      var notifications = Notifier.getCollection();
      var notification = notifications.pop();
      expect(notification.id).toBe('layer-id');
      expect(notification.get('status')).toBe('error');
      expect(notification.get('info')).toBe('infowindow_stuff: something went wrong');
    });
  });

  describe('stateDefinitionModel', function () {
    beforeEach(function () {
      // All "widgets dataviews" fetched, ready to listen state changes
      this.integrations._diDashboard._dashboard.vis.trigger('dataviewsFetched');
    });

    it('should be bind to state changes', function () {
      expect(this.integrations._diDashboard.onStateChanged).toHaveBeenCalled();
    });

    it('should change state model when there is any state map change from DI', function () {
      expect(this.integrations._diDashboard.onStateChanged).toHaveBeenCalled();
      this.integrations.visMap().set('center', [10, 20]);
      expect(this.stateDefinitionModel.updateState).toHaveBeenCalled();
    });

    it('should change state model when there is any state widget change from DI', function () {
      expect(this.integrations._diDashboard.onStateChanged).toHaveBeenCalled();
      // Simulate a widget change
      this.integrations._diDashboard._dashboard.widgets._widgetsCollection.trigger('change');
      expect(this.stateDefinitionModel.updateState).toHaveBeenCalled();
    });

    it('should call to onBoundsSet when state triggers a "boundsSet" event', function () {
      var bounds = [ 808 ];
      this.stateDefinitionModel.setBounds(bounds);
      expect(this.integrations._diDashboard._dashboard.vis.map.setBounds).toHaveBeenCalledWith(bounds);
    });
  });

  describe('overlaysCollection', function () {
    it('should add overlay to CDB overlays collection when a new one is created', function () {
      expect(this.integrations._vis().overlaysCollection.size()).toBe(1);
      var overlayModel = new Backbone.Model({ id: 'hello', type: 'search' });
      this.integrations._overlayDefinitionsCollection.add(overlayModel);
      expect(this.integrations._vis().overlaysCollection.size()).toBe(2);
      expect(this.integrations._vis().overlaysCollection.at(1).id).toBe('hello');
    });

    it('should remove overlay from CDB overlays collection when one is removed', function () {
      expect(this.integrations._vis().overlaysCollection.size()).toBe(1);
      var overlayModel = new Backbone.Model({ id: 'hello', type: 'search' });
      this.integrations._overlayDefinitionsCollection.add(overlayModel);
      expect(this.integrations._vis().overlaysCollection.size()).toBe(2);
      this.integrations._overlayDefinitionsCollection.remove(overlayModel);
      expect(this.integrations._vis().overlaysCollection.size()).toBe(1);
    });
  });

  describe('max/min zoom changes', function () {
    beforeEach(function () {
      this.integrations.visMap().set({
        minZoom: 1,
        maxZoom: 20,
        zoom: 12
      });
      this.mapDefinitionModel.set({
        minZoom: 0,
        maxZoom: 15
      });
      // Avoid HTTP requests setting img src to nothing
      dashBoard._dashboard.dashboardView.$('img').attr('src', '');
    });

    it('should change max and min zoom of the map if changes in map-definition-model', function () {
      expect(this.integrations.visMap().get('minZoom')).toBe(0);
      expect(this.integrations.visMap().get('maxZoom')).toBe(15);
    });

    it('should change map zoom if maxZoom is not as high as the current one', function () {
      expect(this.integrations.visMap().get('zoom')).toBe(12);
      this.mapDefinitionModel.set({
        minZoom: 0,
        maxZoom: 9
      });
      // Avoid HTTP requests setting img src to nothing
      dashBoard._dashboard.dashboardView.$('img').attr('src', '');
      expect(this.integrations.visMap().get('zoom')).toBe(9);
    });
  });

  describe('legends', function () {
    beforeEach(function () {
      this.cdbLayer = createFakeLayer({ id: 'layer-id' });

      this.layerDefinitionsCollection.resetByLayersData({
        id: 'layer-id',
        kind: 'carto',
        options: {
          table_name: 'infowindow_stuff',
          cartocss: ''
        }
      });

      var vizJSON = {
        options: {
          scrollwheel: false
        },
        layers: [
          {
            id: 'layer-id',
            type: 'CartoDB',
            legends: [
              {
                type: 'bubble',
                title: 'My Bubble Legend',
                definition: {
                  color: '#FABADA'
                }
              },
              {
                type: 'choropleth',
                title: 'My Choropleth Legend',
                prefix: 'prefix',
                sufix: 'sufix'
              }
            ]
          }
        ]
      };

      this.legendDefinitionsCollection.resetByData(vizJSON);

      this.bubble = jasmine.createSpyObj('bubble', ['show', 'hide', 'set', 'reset']);
      this.choropleth = jasmine.createSpyObj('choropleth', ['show', 'hide', 'set', 'reset']);
      spyOn(DeepInsightsIntegrations.prototype, '_linkLayerErrors');

      spyOn(DeepInsightsIntegrations.prototype, '_getLayer').and.returnValue({
        legends: {
          bubble: this.bubble,
          choropleth: this.choropleth
        }
      });

      spyOn(LegendDefinitionModel.prototype, 'save');

      var mapModeModel = new MapModeModel();
      var configModel = new ConfigModel({
        base_url: 'pepito'
      });

      this.integrations2 = new DeepInsightsIntegrations({
        userModel: new Backbone.Model(),
        onboardings: createOnboardings(),
        deepInsightsDashboard: createFakeDashboard([ this.cdbLayer ]),
        analysisDefinitionsCollection: this.analysisDefinitionsCollection,
        analysisDefinitionNodesCollection: this.analysisDefinitionNodesCollection,
        layerDefinitionsCollection: this.layerDefinitionsCollection,
        legendDefinitionsCollection: this.legendDefinitionsCollection,
        widgetDefinitionsCollection: this.widgetDefinitionsCollection,
        stateDefinitionModel: this.stateDefinitionModel,
        overlayDefinitionsCollection: this.overlaysCollection,
        visDefinitionModel: this.visDefinitionModel,
        mapDefinitionModel: this.mapDefinitionModel,
        editorModel: this.editorModel,
        mapModeModel: mapModeModel,
        configModel: configModel,
        editFeatureOverlay: new Backbone.View()
      });
    });

    it('should hide legend when a legend def model deleted', function () {
      var layerDefModel = this.layerDefinitionsCollection.at(0);
      var legendDedfModel = this.legendDefinitionsCollection.findByLayerDefModelAndType(layerDefModel, 'choropleth');
      this.legendDefinitionsCollection.remove(legendDedfModel);
      expect(this.choropleth.hide).toHaveBeenCalled();
    });

    it('should update legend when a legend def model update', function () {
      var layerDefModel = this.layerDefinitionsCollection.at(0);
      var legendDedfModel = this.legendDefinitionsCollection.findByLayerDefModelAndType(layerDefModel, 'choropleth');
      legendDedfModel.setAttributes({title: 'Wadus'});
      expect(this.choropleth.set).toHaveBeenCalled();
    });
  });
});
