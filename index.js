#!/usr/bin/env node
/* eslint-disable camelcase */
/* eslint-disable no-console */
require('dotenv').config();
const { argv } = require('yargs');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
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

let access_token;

const loadFeatures = async (i, count, step, layer) => {
  return axios
    .get(
      `https://enterprise.spatialstudieslab.org/server/rest/services/Hosted/pilotplan_RoadsLine_auth/FeatureServer/0/query?where=shape IS NOT NULL&outFields=*&f=geojson&resultRecordCount=${step}&resultOffset=${i}&code=${access_token}`,
      { httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
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

const authenticate = () => {
  const { CLIENT_ID, USERNAME, PASSWORD } = process.env;
  const httpsAgent = new https.Agent({ rejectUnauthorized: false });
  return axios
    .get(
      `https://enterprise.spatialstudieslab.org/portal/sharing/rest/oauth2/authorize/?client_id=${CLIENT_ID}&response_type=code&expiration=3600&redirect_uri=urn:ietf:wg:oauth:2.0:oob`,
      { httpsAgent }
    )
    .then(({ data }) => {
      const oauth = data.replace(/^.*"oauth_state":"(.*?)".*$/gs, '$1');
      return axios
        .post(
          `https://enterprise.spatialstudieslab.org/portal/sharing/oauth2/signin?oauth_state=${oauth}&authorize=true&username=${USERNAME}&password=${PASSWORD}`,
          {},
          { httpsAgent }
        )
        .then(res => {
          const code = res.data.replace(/^.*id="code" value="(.*?)".*$/gs, '$1');
          return axios
            .post(
              `https://enterprise.spatialstudieslab.org/portal/sharing/oauth2/token?client_id=${CLIENT_ID}&code=${code}&redirect_uri=urn:ietf:wg:oauth:2.0:oob&grant_type=authorization_code`,
              {},
              { httpsAgent }
            )
            .then(res2 => {
              ({ access_token } = res2.data.access_token);
              return Promise.resolve();
            });
        });
    });
};

if (argv.upload) {
  fs.readdir('geojson/final').then(files => {
    VECTOR_LAYERS = files.map(f => `geojson/final/${f}`);
    return upload();
  });
} else {
  authenticate().then(() => main());
}
