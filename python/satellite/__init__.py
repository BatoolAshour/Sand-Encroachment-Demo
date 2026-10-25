"""
satellite — real Sentinel-2 imagery for the Satellite Monitoring section.

    providers.py   find a Sentinel-2 L2A scene and read the bands for one area
                   (Copernicus Data Space Ecosystem, or the public AWS archive)
    processing.py  sand detection: colour segmentation, thresholding,
                   texture analysis and morphological clean-up
    roads.py       road centreline (GeoJSON / OpenStreetMap) and its checks
    analysis.py    runs one analysis and writes original.png, overlay.png and
                   result.json into the local cache
    cache.py       cache folder layout and the manifest the dashboard reads

Run it with python/satellite_server.py (Flask API) or python/satellite_cache.py
(command line, pre-caches images for offline demos).

Everything this package reports is derived from real Sentinel-2 pixels.
It never invents values: a number that cannot be computed is returned as
null together with the reason.
"""
