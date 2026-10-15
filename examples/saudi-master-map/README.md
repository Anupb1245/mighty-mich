# Saudi Master Map — Riyadh & Jeddah

One interactive HTML map of Riyadh and Jeddah built from **real OpenStreetMap data**:
city boundaries, every named district / neighbourhood, and the major road network.

## Run

**Google Colab (no install needed):** open `saudi_master_map_colab.ipynb` in Colab and
`Runtime ▸ Run all`. It builds the map, shows it inline and downloads a zip with all outputs.

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/Anupb1245/mighty-mich/blob/claude/festive-hypatia-l5sdmp/examples/saudi-master-map/saudi_master_map_colab.ipynb)

Jupyter: open `saudi_master_map.ipynb` and run all cells.

Terminal:

```bash
pip install osmnx folium matplotlib
python saudi_master_map.py
```

First run downloads from Nominatim + Overpass (5–15 min, a few hundred MB); results are
cached in `./cache` so later runs take seconds. Open `saudi_master_map.html` in a browser.

## Output

| File                         | Contents                                                                 |
| ---------------------------- | ------------------------------------------------------------------------ |
| `saudi_master_map.html`      | the map: 4 basemaps, per-city boundary / districts / point-only / roads layers, district search (EN + AR), hover names, click details, measure, fullscreen, mini-map |
| `riyadh_districts.geojson`   | every Riyadh district polygon with AR/EN names, OSM type, area, OSM id   |
| `jeddah_districts.geojson`   | same for Jeddah                                                          |
| `districts_list.csv`         | one row per district for both cities, incl. ones OSM only has as a point |

## Why nothing is missing

- The city polygon is validated by area (100–8000 km²) so a query that resolves to the
  *Riyadh Region* (province) is rejected and the next spelling is tried.
- Districts are fetched under **both** tagging schemes used for Saudi cities
  (`place=neighbourhood|suburb|quarter|borough` and `boundary=administrative`
  admin_level 8–11), merged, and de-duplicated by name + geometry.
- Districts that exist in OSM only as a point get their own layer instead of being dropped.
- Residential streets are not drawn as vectors (that would be hundreds of MB) but are all
  visible on the basemap tiles when you zoom in. Add `|tertiary` to `ROAD_FILTER` for more
  vector roads.

## Tuning

All knobs are at the top of `saudi_master_map.py`: `CITIES` (queries, colours, hub pins),
`ROAD_FILTER`, `INCLUDE_ROADS`, `DISTRICT_TAGS`, `MIN/MAX_CITY_AREA_KM2`, Overpass mirror.
