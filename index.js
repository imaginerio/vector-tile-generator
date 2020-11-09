#!/usr/bin/env node
/* eslint-disable no-console */
const { argv } = require('yargs');
const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');
const shell = require('shelljs');
const axios = require('axios');
const ora = require('ora');
const { range, omit } = require('lodash');
const mapshaper = require('mapshaper');
const tilelive = require('@mapbox/tilelive');
const MBTiles = require('@mapbox/mbtiles');
const s3 = require('@mapbox/tilelive-s3');

const loadAsync = promisify(tilelive.load);
const copyAsync = promisify(tilelive.copy);

const STEP = 50;
let VECTOR_LAYERS = [];
const spinner = ora('Generating vector tiles\n').start();

const OMIT = ['ParcelsPoly'];
const VISUAL = [
  'AerialExtentsPoly',
  'PlanExtentsPoly',
  'MapExtentsPoly',
  'BasemapExtentsPoly',
  'ViewConesPoly',
];
const featureMapper = f => ({
  ...f,
  properties: {
    Name: f.properties.name,
    FirstYear: f.properties.firstyear,
    LastYear: f.properties.firstyear,
    SubType: f.properties.subtype,
  },
});
const visualMapper = f => ({
  ...f,
  properties: {
    SS_ID: f.properties.ss_id,
    SSC_ID: f.properties.ssc_id,
    CreditLine: f.properties.creditline,
    Creator: f.properties.creator,
    Date: f.properties.date,
    Title: f.properties.title,
    Latitude: f.properties.latitude,
    Longitude: f.properties.longitude,
    FirstYear: f.properties.firstyear,
    LastYear: f.properties.lastyear,
  },
});

const loadFeatures = async (i, count, step, layer) => {
  return axios
    .get(
      `https://arcgis.rice.edu/arcgis/rest/services/pilotPlan_Data/FeatureServer/${layer.id}/query?where=shape IS NOT NULL&outFields=*&f=geojson&resultRecordCount=${step}&resultOffset=${i}`
    )
    .then(({ data }) => {
      spinner.text = `${layer.name}: Loading features ${i} / ${count}`;
      const geojson = omit(data, 'exceededTransferLimit');
      if (geojson.features) {
        const mapper = VISUAL.includes(layer.name) ? visualMapper : featureMapper;
        geojson.features = geojson.features.map(mapper);
        return fs.writeFile(
          path.join(__dirname, 'geojson/', `${layer.name}-${i}.geojson`),
          JSON.stringify(geojson)
        );
      }
      return Promise.resolve();
    })
    .catch(err => console.log(err));
};

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
  spinner.start('Creating MBTiles');
  shell.exec('./tiles.sh');
  spinner.succeed();

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
  await copyAsync(src, dest, options);
  spinner.succeed();
};

const main = async () => {
  spinner.text = 'Loading layer info';
  axios
    .get('https://arcgis.rice.edu/arcgis/rest/services/pilotPlan_Data/FeatureServer/layers?f=json')
    .then(({ data: { layers } }) => {
      spinner.succeed(`${layers.length} layers loaded`);
      return layers
        .filter(l => !OMIT.includes(l.name))
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
            })
            .catch(err => console.log(err));
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
