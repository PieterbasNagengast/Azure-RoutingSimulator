# Azure Routing Simulator

Interactive Azure hub & spoke routing simulator: ExpressRoute, VNet peering, Azure Firewall / VNRA, UDRs and BGP, with your own IP ranges.

Live site: https://azureroutingsimulator.com

## Run locally
Static site, no build step. Open `v2/index.html` in a browser. Tests: `node tests/engine.test.js`.

## Hosting on GitHub Pages (custom domain)
1. Repo **Settings → Pages**: deploy from branch `main`, folder `/ (root)`. The `CNAME` file sets the domain.
2. DNS at your registrar:
   - Apex `azureroutingsimulator.com`: four `A` records → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (optionally the matching `AAAA` records `2606:50c0:8000::153` … `8003::153`).
   - `www`: `CNAME` → `pieterbasnagengast.github.io`.
3. After DNS propagates, enable **Enforce HTTPS** in Pages settings.
