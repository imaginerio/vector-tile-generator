# No local roads buildings, or parcels
tippecanoe -Z 8 -z 11 -pf -pk -ab -ai -f -o allzooms.mbtiles \
  -j '{ "RoadsLine": ["!in", "SubType", "Collector", "Local", "Service"] }' \
  geojson/final/boundariespoly.geojson \
  geojson/final/builtdomainpoly.geojson \
  geojson/final/infrastructureline.geojson \
  geojson/final/openspacespoly.geojson \
  geojson/final/roadsline.geojson \
  geojson/final/sectorspoly.geojson \
  geojson/final/waterbodiespoly.geojson \
  geojson/final/waterslingeoe.json

# Adding in buildings
tippecanoe -Z 12 -z 12 -pf -pk -ab -ai -f -o BuildingsPoly.mbtiles \
  -j '{ "RoadsLine": ["!in", "SubType", "Collector", "Local", "Service"] }' \
  geojson/final/boundariespoly.geojson \
  geojson/final/buildingspoly.geojson \
  geojson/final/builtdomainpoly.geojson \
  geojson/final/infrastructureline.geojson \
  geojson/final/openspacespoly.geojson \
  geojson/final/roadsline.geojson \
  geojson/final/sectorspoly.geojson \
  geojson/final/waterbodiespoly.geojson \
  geojson/final/waterslingeoe.json

# Removing filter to add local roads
tippecanoe -Z 13 -z 17 -pf -pk -ab -ai -f -o LocalRoads.mbtiles \
  geojson/final/boundariespoly.geojson \
  geojson/final/buildingspoly.geojson \
  geojson/final/builtdomainpoly.geojson \
  geojson/final/infrastructureline.geojson \
  geojson/final/openspacespoly.geojson \
  geojson/final/roadsline.geojson \
  geojson/final/sectorspoly.geojson \
  geojson/final/waterbodiespoly.geojson \
  geojson/final/watersline.geojson

mapshaper geojson/final/viewconespoly.geojson -points x=Longitude y=Latitude -o geojson/final/viewconespoint.geojson
tippecanoe -Z 9 -z 17 -pf -pk -pf -f -o ViewCones.mbtiles geojson/final/viewconespoint.geojson

tile-join -pk -f -o tiles.mbtiles allzooms.mbtiles BuildingsPoly.mbtiles LocalRoads.mbtiles ViewCones.mbtiles