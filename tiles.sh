# No local roads buildings, or parcels
tippecanoe -Z 8 -z 11 -pf -pk -ab -ai -f -o allzooms.mbtiles \
  -j '{ "RoadsLine": ["!in", "SubType", "Collector", "Local", "Service"] }' \
  geojson/final/BoundariesPoly.json \
  geojson/final/BuiltDomainPoly.json \
  geojson/final/InfrastructureLine.json \
  geojson/final/OpenSpacesPoly.json \
  geojson/final/RoadsLine.json \
  geojson/final/SectorsPoly.json \
  geojson/final/WaterBodiesPoly.json \
  geojson/final/WatersLine.json

# Adding in buildings
tippecanoe -Z 12 -z 12 -pf -pk -ab -ai -f -o BuildingsPoly.mbtiles \
  -j '{ "RoadsLine": ["!in", "SubType", "Collector", "Local", "Service"] }' \
  geojson/final/BoundariesPoly.json \
  geojson/final/BuildingsPoly.json \
  geojson/final/BuiltDomainPoly.json \
  geojson/final/InfrastructureLine.json \
  geojson/final/OpenSpacesPoly.json \
  geojson/final/RoadsLine.json \
  geojson/final/SectorsPoly.json \
  geojson/final/WaterBodiesPoly.json \
  geojson/final/WatersLine.json

# Removing filter to add local roads
tippecanoe -Z 13 -z 17 -pf -pk -ab -ai -f -o LocalRoads.mbtiles \
  geojson/final/BoundariesPoly.json \
  geojson/final/BuildingsPoly.json \
  geojson/final/BuiltDomainPoly.json \
  geojson/final/InfrastructureLine.json \
  geojson/final/OpenSpacesPoly.json \
  geojson/final/RoadsLine.json \
  geojson/final/SectorsPoly.json \
  geojson/final/WaterBodiesPoly.json \
  geojson/final/WatersLine.json

mapshaper geojson/final/ViewConesPoly.json -points x=Longitude y=Latitude -o geojson/final/ViewConesPoint.json
tippecanoe -Z 9 -z 17 -pf -pk -pf -f -o ViewCones.mbtiles geojson/final/ViewConesPoint.json

tile-join -pk -f -o tiles.mbtiles allzooms.mbtiles BuildingsPoly.mbtiles LocalRoads.mbtiles ViewCones.mbtiles