const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');
const ora = require('ora');
const { range, omit } = require('lodash');
const mapshaper = require('mapshaper');
const tippecanoe = require('tippecanoe');
const tilelive = require('@mapbox/tilelive');
const MBTiles = require('@mapbox/mbtiles');
const s3 = require('@mapbox/tilelive-s3');

const loadAsync = promisify(tilelive.load);
const copyAsync = promisify(tilelive.copy);

const STEP = 200;
const VECTOR_LAYERS = [];

const spinner = ora('Loading layer info').start();

const loadFeatures = async (i, count, step, layer) =>
  axios
    .get(
      `https://arcgis.rice.edu/arcgis/rest/services/imagineRio_Data/FeatureServer/${layer.id}/query?where=shape IS NOT NULL&outFields=objectid,nameshort,nameabbrev,name,firstyear,lastyear,type&f=geojson&resultRecordCount=${step}&resultOffset=${i}`
    )
    .then(({ data }) => {
      spinner.text = `${layer.name}: Loading features ${i} / ${count}`;
      return fs.writeFile(
        path.join(__dirname, 'geojson/', `${layer.name}-${i}.geojson`),
        JSON.stringify(omit(data, 'exceededTransferLimit'))
      );
    });

const loadLayer = async layer => {
  spinner.start(`${layer.name}: Loading features`);
  const {
    data: { count },
  } = await axios.get(
    `https://arcgis.rice.edu/arcgis/rest/services/imagineRio_Data/FeatureServer/${layer.id}/query?where=objectid IS NOT NULL&f=json&returnCountOnly=true`
  );

  const step = layer.name === 'GroundCoverPoly' ? 5 : STEP;
  return range(0, count || 1, step).reduce(async (previousPromise, next) => {
    await previousPromise;
    return loadFeatures(next, count, step, layer);
  }, Promise.resolve());
};

exec('rm geojson/*.geojson && rm geojson/final/*.geojson');
axios
  .get('https://arcgis.rice.edu/arcgis/rest/services/imagineRio_Data/FeatureServer/layers?f=json')
  .then(({ data: { layers } }) => {
    spinner.succeed(`${layers.length} layers loaded`);
    return layers
      .filter(l => !l.name.match(/^ir_rio/))
      .reduce(async (previousPromise, layer) => {
        await previousPromise;
        return loadLayer(layer)
          .then(() =>
            mapshaper.runCommands(
              `-i geojson/${layer.name}*.geojson combine-files -merge-layers -o geojson/final/${layer.name}.geojson force format=geojson id-field=objectid`
            )
          )
          .then(() => {
            VECTOR_LAYERS.push(`geojson/final/${layer.name}.geojson`);
            return spinner.succeed(`${layer.name} loaded`);
          });
      }, Promise.resolve());
  })
  .then(async () => {
    tippecanoe(VECTOR_LAYERS, {
      f: true,
      Z: 9,
      z: 15,
      r1: true,
      o: 'rio.mbtiles',
    });
    s3.registerProtocols(tilelive);
    MBTiles.registerProtocols(tilelive);

    const sourceUri = `mbtiles://${path.join(__dirname, 'rio.mbtiles')}`;
    const sinkUri = process.env.AWS_BUCKET;

    const src = await loadAsync(sourceUri);
    const dest = await loadAsync(sinkUri);
    const options = {
      type: 'list',
      listScheme: src.createZXYStream(),
    };
    return copyAsync(src, dest, options);
  });
