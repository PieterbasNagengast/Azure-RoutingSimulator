# Azure Routing Simulator

Interactive Azure hub & spoke routing simulator: ExpressRoute, VNet peering, Azure Firewall / VNRA, UDRs and BGP, with your own IP ranges.

Live site: https://pieterbasnagengast.github.io/Azure-RoutingSimulator/

## Run locally
Static site, no build step. Open `index.html` in a browser. Tests: `node tests/engine.test.js`. The previous single-file version is kept in `legacy/` (tests: `node tests/legacy.validate.js`).

## Hosting on GitHub Pages
Repo **Settings → Pages**: deploy from branch `main`, folder `/ (root)`.
