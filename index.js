const fs = require('fs').promises;
const axios = require('axios');
const ora = require('ora');
const { range, omit } = require('lodash');
const mapshaper = require('mapshaper');
const tippecanoe = require('tippecanoe');
const tilelive = require('@mapbox/tilelive');
const MBTiles = require('@mapbox/mbtiles');
const s3 = require('@mapbox/tilelive-s3');

const STEP = 50;

const spinner = ora('Loading layer info').start();

axios
  .get('https://arcgis.rice.edu/arcgis/rest/services/imagineRio_Data/FeatureServer/layers?f=json')
  .then(({ data: { layers } }) => {
    spinner.succeed(`${layers.length} layers loaded`);
    const layerRequests = layers.map(layer => {
      spinner.start(`${layer.name}: Loading features`);
      return axios
        .get(
          `https://arcgis.rice.edu/arcgis/rest/services/imagineRio_Data/FeatureServer/${layer.id}/query?where=objectid IS NOT NULL&f=json&returnCountOnly=true`
        )
        .then(({ data: { count } }) => {
          const featureRequests = range(0, count, STEP).map(i =>
            axios
              .get(
                `https://arcgis.rice.edu/arcgis/rest/services/imagineRio_Data/FeatureServer/${layer.id}/query?where=objectid IS NOT NULL&outFields=objectid,nameshort,nameabbrev,name,firstyear,lastyear,type&f=geojson&resultRecordCount=${STEP}&resultOffset=${i}`
              )
              .then(({ data }) => {
                spinner.text = `${layer.name}: Loading features ${i} / ${count}`;
                return fs.writeFile(
                  `geojson/${layer.name}-${i}.geojson`,
                  JSON.stringify(omit(data, 'exceededTransferLimit'))
                );
              })
          );
          return Promise.all(featureRequests).then(() => spinner.succeed(`${layer.name} loaded`));
        });
    });
    return Promise.all(layerRequests);
  });
