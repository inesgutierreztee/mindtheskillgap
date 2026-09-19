<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Transit Companion

Mobile-first Singapore multimodal journey planning with live public transport, walking, and first-mile cycling legs, disruption-aware recommendations, and step-by-step guidance.

View your app in AI Studio: https://ai.studio/apps/b620a348-ed5c-4965-bf28-7b86ac9b2db9

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

To verify the production build locally, run `npm run build` followed by `npm start`.

Bike-and-ride options combine OneMap cycling geometry and turn instructions with OneMap public-transport itineraries. Configure either `ONEMAP_TOKEN` or `ONEMAP_EMAIL` + `ONEMAP_PASSWORD` as documented in `.env.example`. If `LTA_ACCOUNT_KEY` is configured, the app also uses LTA DataMall's BicycleParkingv2 data; otherwise it labels bicycle parking as unverified rather than inventing availability.

## Persona assumptions

The brief gives each persona's corridor and needs; the details below fill the gaps so every recommendation can be computed from live data. Each is a single constant at the top of that persona's home screen.

**Rachel** (`src/screens/RachelHomeScreen.tsx`) — Tampines → Raffles Place on the EWL, leaves 07:40, at her desk by 08:45 (from the brief).
- Desk at Marina Bay Financial Centre Tower 3, a Raffles Place office. Her usual route is the live EWL ride to Raffles Place plus the live OneMap walk from the station; the sheltered alternative is whichever live itinerary walks less (currently EWL + one NSL stop to Marina Bay and the underground Marina Bay Link Mall).
- If live routing is unavailable, a 45-minute scheduled estimate is shown, labelled DEMO DATA.

**Arjun** (`src/screens/ArjunHomeScreen.tsx`) — Punggol → one-north, flexible start within about an hour, comfort over speed (from the brief).
- Home at Blk 261 Punggol Way, beside Soo Teck LRT; work right by one-north MRT.
- Flexible hour taken as 08:00–09:00. The leave time is the quietest boarding slot in that hour from LTA's PCDForecast.
- Options compared: bike-and-ride, bus and LRT first legs, all joining the NEL. In rain, cycling is dropped when his profile says to avoid it.

**Mdm Lim** (`src/screens/MdmLimHomeScreen.tsx`) — Bedok → Singapore General Hospital, fortnightly; avoids stairs, needs lifts (from the brief).
- Home at Blk 539 Bedok North Street 3; destination SGH, 1 Hospital Crescent.
- A demo appointment (tomorrow, 10:30 AM) stands in for a real calendar, and is labelled as such.
- She aims to arrive 30 minutes before her appointment.
- Her walking legs take 1.5× OneMap's standard walking time, to reflect a slower pace.
- Lift checks use live LTA FacilitiesMaintenance for every station where she boards or alights. If her usual station has an outage, the app plans a live detour via a neighbouring station on the same line.

**Judging scenarios** (the controls beside the phone on desktop) pin a demo clock and can simulate rain, crowding or a lift outage. Each override is labelled inside the app; everything else stays live.

Cycling is preference-driven rather than a standalone mode switch. The profile stores comfort triggers, weather/infrastructure/parking avoidance rules, acceptable extra time, and whether the bicycle is parked or folded. Enabling cycling only adds bike-and-ride candidates; scoring recommends one only when the user's selected conditions justify it. Prototype fallback routes live in `src/data/mockCyclingData.ts` and are visibly labelled in the UI.
