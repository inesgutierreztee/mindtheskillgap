# Transit Companion

Transit Companion is a mobile-first Singapore journey-planning application that provides personalised public-transport, walking and first-mile cycling recommendations. It combines live LTA DataMall information with OneMap routing, weather conditions, accessibility needs and commuter preferences to recommend routes before and during a journey.

## Live Application

**Deployed app:** [https://transit-companion-754090303197.asia-southeast1.run.app](https://transit-companion-754090303197.asia-southeast1.run.app)

The application is designed for a phone-sized browser. It can also be opened on desktop, where additional labelled judging controls appear beside the mobile interface.

## Recommended Journey to Try

The most reliable judging flow is Mdm Lim's accessible journey:

1. Open the application and complete onboarding.
2. Select **Mdm Lim** as the commuter persona.
3. On a desktop-sized browser, select **Lift unavailable** under **Judging controls**.
4. Review how the application explains the simulated lift outage and recommends an accessible alternative for the Bedok-to-Singapore General Hospital journey.
5. Open the recommended route to view its route details and step-by-step guidance.

The outage is explicitly labelled as simulated inside the application. Other available judging scenarios demonstrate rain, crowding and routine-dependent recommendations.

## Prerequisites

- Node.js 22 LTS
- npm 10 or later
- A free [LTA DataMall](https://datamall.lta.gov.sg/) account for live transport information
- A free [OneMap](https://www.onemap.gov.sg/apidocs/register) account for live public-transport and cycling routes

## Install and Run Locally

Clone the repository and enter its directory:

```bash
git clone https://github.com/inesgutierreztee/mindtheskillgap.git
cd mindtheskillgap
```

Install the dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env.local
```

Add your LTA DataMall and OneMap credentials to `.env.local`, then start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a browser.

To verify the production build locally:

```bash
npm run build
npm start
```

## Configuration

Never commit `.env`, `.env.local`, API keys, passwords or access tokens. The repository should contain only `.env.example` with empty values.

| Variable | Required? | Purpose |
|---|---:|---|
| `LTA_ACCOUNT_KEY` | Recommended | Live bus arrivals, train service alerts, platform crowd information, lift maintenance and bicycle-parking information. |
| `ONEMAP_TOKEN` | One OneMap option required | Pre-generated OneMap token. This is simple to configure but expires periodically. |
| `ONEMAP_EMAIL` | Alternative to token | Allows the server to obtain and refresh a OneMap token automatically. Use together with `ONEMAP_PASSWORD`. |
| `ONEMAP_PASSWORD` | Alternative to token | Used with `ONEMAP_EMAIL`. Keep it only in the deployment platform's secret manager or a local ignored environment file. |
| `PORT` | Optional | Local server port. Defaults to `3000`. |

Example `.env.example`:

```env
LTA_ACCOUNT_KEY=
ONEMAP_TOKEN=
ONEMAP_EMAIL=
ONEMAP_PASSWORD=
PORT=3000
```

Either `ONEMAP_TOKEN` or the `ONEMAP_EMAIL` and `ONEMAP_PASSWORD` pair should be configured. Do not configure both unless you intentionally want the pre-generated token to take priority.

Without the relevant credentials, the app falls back to bundled demonstration data where available and labels it **DEMO DATA**. Cycling remains unavailable when a genuine OneMap route cannot be obtained rather than presenting a synthetic cycling route as live.

## Train-Disruption Simulation

The backend includes a labelled mock MRT disruption response for testing:

```text
GET /api/disruptions?simulate=true
```

For example, when running locally:

```text
http://localhost:3000/api/disruptions?simulate=true
```

This returns the bundled simulated train-disruption data with `source: "simulated_test"` and `isSimulated: true`.

**Current limitation:** the normal frontend requests the live disruption endpoint and does not currently provide a visible control for switching to the simulated MRT disruption. Therefore, when LTA reports normal train service, the MRT-disruption simulation can be verified through the endpoint above but cannot be activated through the commuter interface. The visible judging controls currently cover simulated rain, crowding and lift outages. This limitation should not be described as a completed UI feature.

## Personas and Assumptions

### Rachel — Fixed-schedule commuter

- Journey: Tampines to Raffles Place
- Typical departure: 7:40 AM
- Target arrival: 8:45 AM
- Assumed workplace: Marina Bay Financial Centre Tower 3
- Preference: minimal interruption, with proactive guidance when a disruption materially affects her routine

If live routing is unavailable, the application displays a scheduled estimate marked **DEMO DATA**.

### Arjun — Flexible commuter

- Journey: Punggol to one-north
- Flexible departure window: 8:00–9:00 AM
- Assumed home: Blk 261 Punggol Way, near Soo Teck LRT
- Preference: comfort over speed

The application compares bus, LRT and eligible bike-and-ride first-mile options. Cycling candidates are removed or penalised when his configured preferences and current weather make them unsuitable.

### Mdm Lim — Accessibility-focused commuter

- Journey: Bedok to Singapore General Hospital
- Assumed home: Blk 539 Bedok North Street 3
- Demo appointment: tomorrow at 10:30 AM
- Target arrival: 30 minutes before the appointment
- Preference: step-free routes with working lifts

The appointment is explicitly identified as demonstration data. Her walking legs are estimated at 1.5 times OneMap's standard walking duration. Live lift checks use LTA FacilitiesMaintenance information for relevant boarding and alighting stations.

## Data Sources

- **LTA DataMall:** bus arrivals, train service alerts, passenger-volume forecasts, station-facility maintenance and bicycle-parking information
- **OneMap:** geocoding, public-transport itineraries, walking legs, cycling geometry and turn instructions
- **data.gov.sg weather feeds:** current rain conditions used by weather-aware recommendations
- **Bundled demonstration data:** labelled fallback and judging scenarios used when a live event is unavailable

## Network-Aware Recommendations

The application evaluates route suitability using personal cost, live or forecast network conditions, fairness guardrails and recommendation stability. Normalised demand and capacity values used by the network-aware model are prototype proxies; they are not official passenger counts or official LTA capacity figures.

The included test reports demonstrate software behaviour and compatibility with the application's route structures. They do not establish real-world congestion-prediction accuracy.

## Verification Commands

```bash
npm run lint
npm run build
npm run test:network-aware
```

The live network-aware test additionally requires a running server and valid API credentials:

```bash
npm run test:network-aware-live
```

## Known Limitations

- Live transport and route coverage depends on the availability and contents of external LTA and OneMap feeds.
- OneMap tokens expire periodically unless the email/password refresh option is configured securely.
- Train-arrival countdowns are not available from the current official data sources used by the prototype.
- The MRT-disruption simulation exists in the backend but is not yet selectable through the frontend.
- The network demand-and-capacity model is not empirically calibrated and must not be interpreted as official crowd or capacity data.
- Some journeys use explicitly labelled demonstration assumptions so the personas remain testable when live disruptions are absent.

## Credential Safety

- Store local credentials only in `.env.local`.
- Store deployed credentials in the cloud platform's secret manager or environment-variable configuration.
- Never place secrets in frontend code, screenshots, README examples, commit history or GitHub Actions logs.
- If a credential has ever been committed, remove it from history and rotate it before submission.

## Repository Structure

```text
.
├── README.md
├── WRITEUP.md
├── .env.example
├── package.json
├── server.ts
├── scripts/
└── src/
```

See `WRITEUP.md` for the selected persona, architecture, design decisions, assumptions, evidence for numerical claims and known limitations.
