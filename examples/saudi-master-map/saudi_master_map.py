"""
Saudi Master Map — Riyadh + Jeddah, built from real OpenStreetMap data.

What it produces (all in OUTPUT_DIR):
  saudi_master_map.html      one interactive map (toggle layers, search districts,
                              hover for names, click for details, measure, fullscreen)
  riyadh_districts.geojson    every district / neighbourhood polygon for Riyadh
  jeddah_districts.geojson    every district / neighbourhood polygon for Jeddah
  districts_list.csv          one row per district, both cities (name AR/EN, type,
                              area km², whether OSM has a polygon or only a point)

How "nothing is missing" is guaranteed:
  * The city boundary comes from Nominatim and is sanity-checked by area, so you
    never silently get the Riyadh *Region* (province) instead of the city.
  * Districts are pulled with BOTH tagging schemes used in Saudi OSM data:
      place=neighbourhood / suburb / quarter / borough
      boundary=administrative + admin_level 8–11
    Everything is merged and de-duplicated by name + geometry.
  * Districts that OSM only has as a *point* (no polygon drawn yet) are still
    shown, in a separate "point-only" layer, so no name is dropped.
  * Major roads (motorway → secondary) are drawn as their own layer. Every other
    street is still visible on the base tiles when you zoom in; drawing every
    residential street as vectors would make the HTML hundreds of MB.

Run in Jupyter (first cell):   %pip install -q osmnx folium matplotlib
Then run this file / cell. First run downloads a few hundred MB from Overpass
and can take 5–15 min; results are cached in ./cache so re-runs are seconds.
"""

from __future__ import annotations

import csv
import json
import math
import time
from pathlib import Path

import folium
import geopandas as gpd
import osmnx as ox
import pandas as pd
from branca.element import Element
from folium import plugins
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry

# ───────────────────────────── configuration ──────────────────────────────

OUTPUT_DIR = Path(".")
OUTPUT_HTML = "saudi_master_map.html"

# Several query spellings per city; the first one that returns a polygon of a
# plausible *city* size wins. Add/override entries here if Nominatim changes.
CITIES: dict[str, dict] = {
    "Riyadh": {
        "queries": ["Riyadh, Riyadh Region, Saudi Arabia", "Riyadh, Saudi Arabia", "الرياض"],
        "fill": "#e74c3c",
        "edge": "#c0392b",
        "hub": {"lat": 24.7136, "lon": 46.6753, "label": "Riyadh Operations Center"},
    },
    "Jeddah": {
        "queries": ["Jeddah, Makkah Region, Saudi Arabia", "Jeddah, Saudi Arabia", "جدة"],
        "fill": "#3498db",
        "edge": "#2980b9",
        "hub": {"lat": 21.5433, "lon": 39.1728, "label": "Jeddah Operations Center"},
    },
}

# A real city polygon is between these two; outside → it was the province or a
# single building, so the next query is tried.
MIN_CITY_AREA_KM2 = 100
MAX_CITY_AREA_KM2 = 8000

DISTRICT_TAGS = {
    "place": ["neighbourhood", "suburb", "quarter", "borough"],
    "boundary": "administrative",
}
DISTRICT_ADMIN_LEVELS = {8, 9, 10, 11}

INCLUDE_ROADS = True
# Overpass regex on highway=*. Add "|tertiary" for more roads (bigger file).
ROAD_FILTER = '["highway"~"motorway|motorway_link|trunk|trunk_link|primary|secondary"]'
ROAD_SIMPLIFY_DEG = 0.00005  # ≈ 5 m; keeps shape, shrinks the HTML a lot

ROAD_STYLE = {
    "motorway": {"color": "#8e44ad", "weight": 3.5},
    "motorway_link": {"color": "#8e44ad", "weight": 1.5},
    "trunk": {"color": "#d35400", "weight": 3},
    "trunk_link": {"color": "#d35400", "weight": 1.5},
    "primary": {"color": "#f39c12", "weight": 2.5},
    "secondary": {"color": "#7f8c8d", "weight": 1.5},
    "tertiary": {"color": "#95a5a6", "weight": 1},
}

# osmnx / network settings
ox.settings.use_cache = True
ox.settings.cache_folder = "./cache"
ox.settings.log_console = False
ox.settings.requests_timeout = 600
ox.settings.overpass_rate_limit = True
# If the default Overpass server is slow/blocked, uncomment one mirror:
# ox.settings.overpass_url = "https://overpass.kumi.systems/api"
# ox.settings.overpass_url = "https://lz4.overpass-api.de/api"


# ───────────────────────────── helpers ─────────────────────────────────────


def log(msg: str) -> None:
    print(time.strftime("[%H:%M:%S] ") + msg, flush=True)


def area_km2(geom: BaseGeometry, crs="EPSG:4326") -> float:
    """Accurate area in km² using the local UTM zone."""
    s = gpd.GeoSeries([geom], crs=crs)
    return float(s.to_crs(s.estimate_utm_crs()).area.iloc[0] / 1e6)


def to_polygon(geom: BaseGeometry) -> Polygon | MultiPolygon | None:
    if isinstance(geom, (Polygon, MultiPolygon)):
        return geom
    return None


def scalar(v):
    """OSM tags can come back as lists; flatten to a plain string or None."""
    if isinstance(v, list):
        v = "; ".join(str(x) for x in v if x is not None)
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return str(v)


def geocode_city(city: str, queries: list[str]) -> gpd.GeoDataFrame:
    """Return a 1-row GeoDataFrame with the *city* polygon (never the province)."""
    last_err: Exception | None = None
    for q in queries:
        try:
            gdf = ox.geocode_to_gdf(q)
        except Exception as e:  # noqa: BLE001 — try the next spelling
            last_err = e
            log(f"  geocode '{q}' failed: {e}")
            continue
        geom = to_polygon(gdf.geometry.iloc[0])
        if geom is None:
            log(f"  geocode '{q}' returned a non-polygon, trying next")
            continue
        a = area_km2(geom)
        if MIN_CITY_AREA_KM2 <= a <= MAX_CITY_AREA_KM2:
            name = gdf.get("display_name", pd.Series([q])).iloc[0]
            log(f"  ✓ {city}: '{name}' ({a:,.0f} km²)")
            gdf = gdf.iloc[[0]].copy()
            gdf["city"] = city
            gdf["area_km2"] = round(a, 1)
            return gdf
        log(f"  geocode '{q}' gave {a:,.0f} km² (not a city-sized polygon), trying next")
    raise RuntimeError(f"Could not geocode a city polygon for {city}: {last_err}")


def fetch_districts(city: str, city_poly: Polygon | MultiPolygon) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
    """
    Returns (polygon_districts, point_only_districts) for one city.
    Both have columns: city, name, name_en, name_ar, search_name, kind, osm_id, area_km2.
    """
    raw = ox.features_from_polygon(city_poly, DISTRICT_TAGS)
    if raw.empty:
        log(f"  ⚠ {city}: Overpass returned no district features")
        empty = gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326")
        return empty, empty

    raw = raw.reset_index()  # osmnx gives MultiIndex (element, id)
    for col in ("name", "name:en", "name:ar", "place", "boundary", "admin_level", "element", "id"):
        if col not in raw.columns:
            raw[col] = None

    city_area = area_km2(city_poly)
    rows = []
    # NB: not itertuples() — it renames "name:en"-style columns to _1, _2, …
    for d in raw.to_dict("records"):
        name = scalar(d.get("name"))
        name_en = scalar(d.get("name:en"))
        name_ar = scalar(d.get("name:ar"))
        if not (name or name_en or name_ar):
            continue  # unnamed → not a district anyone can refer to

        place = scalar(d.get("place"))
        boundary = scalar(d.get("boundary"))
        admin_level = scalar(d.get("admin_level"))
        geom = d["geometry"]
        poly = to_polygon(geom)

        if place in DISTRICT_TAGS["place"]:
            kind = place
        elif boundary == "administrative":
            try:
                lvl = int(admin_level)
            except (TypeError, ValueError):
                continue
            if lvl not in DISTRICT_ADMIN_LEVELS:
                continue
            kind = f"admin_level {lvl}"
        else:
            continue

        a = None
        if poly is not None:
            a = area_km2(poly)
            if a > 0.5 * city_area:
                continue  # that's the city/province itself, not a district
        elif geom.geom_type != "Point":
            continue  # a stray line; neither polygon nor point

        local = name or name_ar or name_en
        name_en = name_en or (name if name and name.isascii() else None)
        name_ar = name_ar or (name if name and not name.isascii() else None)
        rows.append(
            {
                "city": city,
                "name": local,
                "name_en": name_en,
                "name_ar": name_ar,
                "search_name": " | ".join(dict.fromkeys(v for v in (name_en, name_ar, local) if v)),
                "kind": kind,
                "osm_id": f"{scalar(d.get('element'))}/{scalar(d.get('id'))}",
                "area_km2": round(a, 3) if a is not None else None,
                "geometry": poly if poly is not None else geom,
            }
        )

    gdf = gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")
    if gdf.empty:
        return gdf, gdf.copy()

    # pandas turns None into NaN; put None back so tooltips/CSV never show "nan"
    for col in ("name_en", "name_ar"):
        gdf[col] = gdf[col].astype(object).where(pd.notna(gdf[col]), None)

    # de-duplicate: same name + same geometry (way + relation describing one area)
    gdf["_wkb"] = gdf.geometry.map(lambda g: g.wkb_hex)
    gdf = gdf.drop_duplicates(subset=["name", "_wkb"]).drop(columns="_wkb")

    polys = gdf[gdf.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    points = gdf[gdf.geometry.geom_type == "Point"].copy()

    # a point with the same name that sits inside its polygon is just the label
    # node of that polygon → not a separate district
    if not polys.empty and not points.empty:
        keep = []
        for p in points.itertuples():
            same = polys[polys["name"] == p.name]
            keep.append(not same.geometry.contains(p.geometry).any())
        points = points[keep]

    # if the same name has several polygons (e.g. admin boundary + place area),
    # keep the largest one
    polys = polys.sort_values("area_km2", ascending=False).drop_duplicates(subset=["name"])
    polys = polys.sort_values("name").reset_index(drop=True)
    points = points.sort_values("name").reset_index(drop=True)
    return polys, points


def fetch_major_roads(city: str, city_poly: Polygon | MultiPolygon) -> gpd.GeoDataFrame:
    G = ox.graph_from_polygon(
        city_poly, network_type="drive", simplify=True, retain_all=True,
        truncate_by_edge=True, custom_filter=ROAD_FILTER,
    )
    edges = ox.graph_to_gdfs(G, nodes=False, edges=True).reset_index()
    for col in ("highway", "name", "name:en", "ref"):
        if col not in edges.columns:
            edges[col] = None
    out = gpd.GeoDataFrame(
        {
            "city": city,
            "highway": edges["highway"].map(lambda v: scalar(v).split("; ")[0] if scalar(v) else "unclassified"),
            "name": edges["name"].map(scalar).astype(object),
            "name_en": edges["name:en"].map(scalar).astype(object),
            "ref": edges["ref"].map(scalar).astype(object),
        },
        geometry=edges.geometry.simplify(ROAD_SIMPLIFY_DEG, preserve_topology=True),
        crs="EPSG:4326",
    )
    for col in ("name", "name_en", "ref"):
        out[col] = out[col].where(pd.notna(out[col]), None)
    out["label"] = [
        " / ".join(dict.fromkeys(v for v in (ref, en, nm) if v)) or hw
        for ref, en, nm, hw in zip(out["ref"], out["name_en"], out["name"], out["highway"])
    ]
    return out


# ───────────────────────────── map building ────────────────────────────────


def add_base_layers(m: folium.Map) -> None:
    folium.TileLayer("OpenStreetMap", name="OpenStreetMap (all streets)", show=True).add_to(m)
    folium.TileLayer("Esri.WorldStreetMap", name="Esri World Street Map", show=False).add_to(m)
    folium.TileLayer("Esri.WorldImagery", name="Esri Satellite", show=False).add_to(m)
    folium.TileLayer("Esri.WorldTopoMap", name="Esri Topographic", show=False).add_to(m)


def add_city(m: folium.Map, city: str, cfg: dict, boundary: gpd.GeoDataFrame,
             polys: gpd.GeoDataFrame, points: gpd.GeoDataFrame, roads: gpd.GeoDataFrame | None) -> folium.GeoJson:
    fill, edge = cfg["fill"], cfg["edge"]

    # 1. city boundary
    fg_b = folium.FeatureGroup(name=f"{city} — city boundary", show=True)
    folium.GeoJson(
        json.loads(boundary[["city", "area_km2", "geometry"]].to_json()),
        style_function=lambda _f, e=edge: {"fillColor": e, "color": e, "weight": 3, "fillOpacity": 0.04, "dashArray": "8 6"},
        tooltip=f"{city} city limit — {boundary['area_km2'].iloc[0]:,} km²",
    ).add_to(fg_b)
    fg_b.add_to(m)

    # 2. district polygons (searchable)
    fg_d = folium.FeatureGroup(name=f"{city} — districts ({len(polys)})", show=True)
    fields = ["name", "name_en", "name_ar", "kind", "area_km2", "osm_id"]
    aliases = ["District", "English", "Arabic", "OSM type", "Area km²", "OSM id"]
    gj_cols = fields + ["search_name", "geometry"]
    districts_gj = folium.GeoJson(
        json.loads(polys[gj_cols].to_json()) if not polys.empty else {"type": "FeatureCollection", "features": []},
        name=f"{city} districts",
        style_function=lambda _f, f=fill, e=edge: {"fillColor": f, "color": e, "weight": 1.2, "fillOpacity": 0.18},
        highlight_function=lambda _f, e=edge: {"weight": 3, "color": "#111", "fillOpacity": 0.45},
        tooltip=folium.GeoJsonTooltip(fields=["name", "name_en", "kind"], aliases=["", "", ""], labels=False, sticky=True),
        popup=folium.GeoJsonPopup(fields=fields, aliases=aliases, localize=True, max_width=320),
        zoom_on_click=True,
    )
    districts_gj.add_to(fg_d)
    fg_d.add_to(m)

    # 3. point-only districts (OSM has a name + location but no polygon yet)
    fg_p = folium.FeatureGroup(name=f"{city} — districts, point only ({len(points)})", show=True)
    cluster = plugins.MarkerCluster(disableClusteringAtZoom=12, spiderfyOnMaxZoom=False)
    for r in points.itertuples():
        folium.CircleMarker(
            location=[r.geometry.y, r.geometry.x], radius=6, color=edge, fill=True, fill_color=fill, fill_opacity=0.9,
            tooltip=f"{r.name}" + (f" / {r.name_en}" if r.name_en and r.name_en != r.name else ""),
            popup=folium.Popup(f"<b>{r.name}</b><br>{r.name_en or ''}<br><i>{r.kind} (point only in OSM)</i><br>{r.osm_id}", max_width=260),
        ).add_to(cluster)
    cluster.add_to(fg_p)
    fg_p.add_to(m)

    # 4. major roads
    if roads is not None and not roads.empty:
        fg_r = folium.FeatureGroup(name=f"{city} — major roads ({len(roads):,} segments)", show=False)
        folium.GeoJson(
            json.loads(roads[["highway", "label", "geometry"]].to_json()),
            style_function=lambda f: {**{"color": "#7f8c8d", "weight": 1}, **ROAD_STYLE.get(f["properties"]["highway"], {}), "opacity": 0.9},
            tooltip=folium.GeoJsonTooltip(fields=["label", "highway"], aliases=["Road", "Class"], sticky=True),
        ).add_to(fg_r)
        fg_r.add_to(m)

    # 5. hub marker
    hub = cfg["hub"]
    folium.Marker(
        location=[hub["lat"], hub["lon"]],
        popup=f"<b>{city} Hub</b><br>{hub['label']}",
        tooltip=f"{city} Hub",
        icon=folium.Icon(color="darkred", icon="building", prefix="fa"),
    ).add_to(m)

    return districts_gj


def add_controls(m: folium.Map, search_layers: list[folium.GeoJson], summary_html: str) -> None:
    for gj in search_layers:
        plugins.Search(
            layer=gj, search_label="search_name", placeholder="Search a district (EN / AR)…",
            collapsed=True, position="topleft",
        ).add_to(m)
    plugins.Fullscreen(position="topleft").add_to(m)
    plugins.LocateControl(position="topleft").add_to(m)
    plugins.MeasureControl(position="topright", primary_length_unit="kilometers", primary_area_unit="sqkilometers").add_to(m)
    plugins.MousePosition(position="bottomright", separator=" , ", num_digits=5, prefix="lat/lon:").add_to(m)
    plugins.MiniMap(toggle_display=True, position="bottomleft").add_to(m)
    folium.LayerControl(collapsed=False).add_to(m)

    m.get_root().html.add_child(Element(f"""
<div style="position:fixed; top:10px; left:50%; transform:translateX(-50%); z-index:9999;
            background:rgba(255,255,255,.93); padding:8px 14px; border-radius:8px;
            box-shadow:0 1px 6px rgba(0,0,0,.35); font:13px/1.35 system-ui, sans-serif; max-width:520px;">
  <b>Saudi Master Map — Riyadh &amp; Jeddah</b> · live OpenStreetMap data<br>
  {summary_html}<br>
  <span style="color:#555">Hover a district for its name · click for details · 🔍 to search · zoom in for every street</span>
</div>"""))


# ───────────────────────────── main ────────────────────────────────────────


def build(output_dir: Path = OUTPUT_DIR, include_roads: bool = INCLUDE_ROADS) -> Path:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    log("🌐 Building the Riyadh + Jeddah master map from OpenStreetMap…")
    m = folium.Map(location=[23.2, 42.9], zoom_start=6, tiles=None, control_scale=True, prefer_canvas=True)
    add_base_layers(m)

    search_layers: list[folium.GeoJson] = []
    all_rows: list[dict] = []
    summary_parts: list[str] = []
    bounds: list[list[float]] = []

    for city, cfg in CITIES.items():
        log(f"── {city}")
        log("  geocoding city boundary…")
        boundary = geocode_city(city, cfg["queries"])
        city_poly = boundary.geometry.iloc[0]
        minx, miny, maxx, maxy = city_poly.bounds
        bounds += [[miny, minx], [maxy, maxx]]

        log("  fetching every district / neighbourhood (place=* + boundary=administrative)…")
        polys, points = fetch_districts(city, city_poly)
        log(f"  ✓ {len(polys)} district polygons + {len(points)} point-only districts")

        roads = None
        if include_roads:
            log("  fetching major road network (motorway → secondary)…")
            roads = fetch_major_roads(city, city_poly)
            log(f"  ✓ {len(roads):,} road segments")

        search_layers.append(add_city(m, city, cfg, boundary, polys, points, roads))

        if not polys.empty:
            polys.to_file(output_dir / f"{city.lower()}_districts.geojson", driver="GeoJSON")
        for df, has_poly in ((polys, True), (points, False)):
            for r in df.itertuples():
                all_rows.append({"city": city, "name": r.name, "name_en": r.name_en, "name_ar": r.name_ar,
                                 "kind": r.kind, "area_km2": r.area_km2 if has_poly else None,
                                 "has_polygon": has_poly, "osm_id": r.osm_id})
        summary_parts.append(f"<b>{city}</b>: {len(polys)} districts mapped"
                             + (f" + {len(points)} point-only" if len(points) else "")
                             + (f", {len(roads):,} major-road segments" if roads is not None else ""))

    csv_path = output_dir / "districts_list.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["city", "name", "name_en", "name_ar", "kind", "area_km2", "has_polygon", "osm_id"])
        w.writeheader()
        w.writerows(all_rows)

    add_controls(m, search_layers, " · ".join(summary_parts))
    if bounds:
        m.fit_bounds(bounds, padding=(30, 30))

    out = output_dir / OUTPUT_HTML
    m.save(str(out))
    size_mb = out.stat().st_size / 1e6
    log(f"✅ Done. Map: {out} ({size_mb:.1f} MB) · district list: {csv_path}")
    log("   Open the HTML in a browser (needs internet for tiles/Leaflet).")
    return out


if __name__ == "__main__":
    build()
