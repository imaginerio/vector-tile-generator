#!/usr/bin/env node
const { argv } = require('yargs');
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

const STEP = 100;
let VECTOR_LAYERS = [];
const spinner = ora('Generating vector tiles\n').start();

const loadFeatures = async (i, count, step, layer) => {
  return axios
    .get(
      `https://arcgis.rice.edu/arcgis/rest/services/pilotPlan_Data/FeatureServer/${layer.id}/query?where=shape IS NOT NULL&outFields=*&f=geojson&resultRecordCount=${step}&resultOffset=${i}`
    )
    .then(({ data }) => {
      spinner.text = `${layer.name}: Loading features ${i} / ${count}`;
      const geojson = omit(data, 'exceededTransferLimit');
      geojson.features = geojson.features.map(f => ({
        ...f,
        properties: {
          Name: f.properties.name,
          FirstYear: f.properties.firstyear,
          LastYear: f.properties.firstyear,
          SubType: f.properties.subtype,
        }
      }))
      return fs.writeFile(
        path.join(__dirname, 'geojson/', `${layer.name}-${i}.geojson`),
        JSON.stringify(geojson)
      );
    }).catch(err => console.log(err));
  }

const loadLayer = async layer => {
  spinner.start(`${layer.name}: Loading features`);
  const {
    data: { count },
  } = await axios.get(
    `https://arcgis.rice.edu/arcgis/rest/services/pilotPlan_Data/FeatureServer/${layer.id}/query?where=objectid IS NOT NULL&f=json&returnCountOnly=true`
  );

  const step = STEP;
  return range(0, count || 1, step).reduce(async (previousPromise, next) => {
    await previousPromise;
    return loadFeatures(next, count, step, layer);
  }, Promise.resolve());
};

const upload = async () => {
  tippecanoe(VECTOR_LAYERS, {
    f: true,
    Z: 9,
    z: 15,
    r1: true,
    o: 'rio.mbtiles',
  });

  spinner.start('Uploading vector tiles to S3');
  s3.registerProtocols(tilelive);
  MBTiles.registerProtocols(tilelive);

  const sourceUri = `mbtiles://${path.join(__dirname, 'tiles.mbtiles')}`;
  const sinkUri = process.env.AWS_BUCKET;

  const src = await loadAsync(sourceUri);
  const dest = await loadAsync(sinkUri);
  const options = {
    type: 'list',
    listScheme: src.createZXYStream(),
  };
  return copyAsync(src, dest, options).then(() => spinner.succeed());
};

const main = () => {
  exec('rm geojson/*.geojson && rm geojson/final/*.geojson');
  spinner.text = 'Loading layer info';
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
                `-i geojson/${layer.name}*.geojson combine-files -merge-layers
                -o geojson/final/${layer.name.toLowerCase()}.geojson force format=geojson id-field=objectid`
              )
            )
            .then(() => {
              VECTOR_LAYERS.push(`geojson/final/${layer.name.toLowerCase()}.geojson`);
              return spinner.succeed(`${layer.name} loaded`);
            });
        }, Promise.resolve());
    })
    .then(upload);
};

if (argv.upload) {
  fs.readdir('geojson/final').then(files => {
    VECTOR_LAYERS = files.map(f => `geojson/final/${f}`);
    return upload();
  });
} else {
  main();
}
