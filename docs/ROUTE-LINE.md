# Road route line on the live tracking maps

The customer's tracking map and the admin's live-deliveries map draw the **road route** from the delivery partner to the
delivery address, and the arrival time uses that road distance. The map needs a routing service to know the roads.
Without one, **no line is drawn** (a straight line looked like a random route), and the time falls back to an estimate
(straight distance × 1.3).

## Turn it on (OpenRouteService, free)

1. Create a free account at <https://openrouteservice.org/dev/#/signup> (no card).
2. In the dashboard, request a token (Standard / free plan). Free limit: 2,000 route lookups a day.
3. In hPanel → the staging app → Deployments → Settings and redeploy → Environment variables, add
   `ORS_API_KEY` = your token. Do not paste it in chat or in GitHub.
4. Save and redeploy. Open a delivery that is on its way: the line follows the streets and the time badge says “by road”.

Optional: `ORS_PROFILE` (default `driving-car`), `ORS_DAILY_LIMIT` (default 1800, kept below the free 2,000).

Alternative: a self-hosted OSRM engine (`OSRM_URL`) is used if no ORS key is set; it also powers distance-based pricing.

## How lookups are kept low

- One lookup per order, reused for every viewer (customer and admin).
- A new lookup only when the rider is more than about 150 m off the stored route, or the route is 3 minutes old;
  never more than once every 20 seconds per order.
- Between lookups the stored route is cut to start at the rider's current position, so the line shrinks as they ride.
- Daily cap (`ORS_DAILY_LIMIT`); above it, the map shows no line and the time uses the estimate until the next day.

## Privacy

Only two points are sent to OpenRouteService (the rider's current position and the delivery point), not names, phone
numbers or order details. OpenRouteService is run by HeiGIT in Germany.
