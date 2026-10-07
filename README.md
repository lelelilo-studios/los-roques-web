# Los Roques

**https://lelelilo-studios.github.io/los-roques-web/**

A real-time simulation of the Los Roques archipelago (Venezuela) that runs in the browser: the clear water over
white sand, the cays and sandbars, the barrier reef, the trade-wind sky. The islands, shorelines, water depths and
seabed come from satellite data; the waves, the light and the weather are simulated.

- Drag to move, right-drag (or two fingers) to turn and tilt, scroll or pinch to zoom, double-click to fly to a point.
- Pick a place, a time of day, a month and the weather in the panel; "Compare with the satellite image" shows the
  Sentinel-2 picture the scene was derived from.

This repository only holds the published site (plain ES modules and three.js, no build step); `build.json` says
which build is live.

## Data and credits

Contains modified Copernicus Sentinel data (2021, 2024). Copernicus DEM GLO-30: produced using Copernicus
WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the
European Union and ESA; all rights reserved. GEBCO Compilation Group (2026) GEBCO 2026 Grid. Allen Coral Atlas
(2022), CC BY 4.0, doi.org/10.5281/zenodo.3833242. © OpenStreetMap contributors (ODbL). Climate normals from NASA
POWER and Open-Meteo. three.js (MIT).

Depths inside the lagoon are estimated from the colour of the water in the satellite image; they are plausible,
not surveyed. Not for navigation.
