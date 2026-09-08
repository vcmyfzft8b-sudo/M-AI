# Memory palace

The town uses a deterministic seed per note. Memory locations alternate between furnished houses and outdoor landmarks; farthest-point sampling distributes their actual positions across the town. Indoor and outdoor landmarks retain their number and identity across visits. Every house has an open entrance, with the same wall and furniture definitions used for rendering and collision checks.

The skyline follows the supplied futuristic city references: cyan glazing, white structural bands, crossing spiral towers, tapered towers, stepped planted terraces and rounded apartment blocks. Each address has a stable silhouette. Ground-floor lobbies have a 5.58 m ceiling and a clear 2.8 m-wide, 3.6 m-high entrance. Roof gardens use the actual top-floor footprint; terrace planting is confined to exposed ledges.

Cars use shared curved body, cabin and roof meshes with sloped glazing, round lights, alloy wheels, mirrors and a restrained paint palette. Palms use tapered segmented trunks and curved feathered fronds. Fountains, traffic signals, paving joints and planted squares are generated locally from geometry. The scene batches these repeated parts into instanced meshes instead of downloading separate models for each building or car.

The red-cap block character has jacket and backpack details, fitted hands and sneakers, knee articulation, and a coordinated walking animation. The camera remains third person. Walking is 5.2 metres/second and running is 9.2. The movement hint disappears after the first movement. The minimap pins distant memories to its rim; the large map offers selectable numbered locations and direct travel. Both maps show collected memories and the player's camera direction.

Study controls are shared with the main app: `StudyFlashcard`, `StudyQuizQuestion`, `StudyPracticeQuestion`, `StudyCompletionCard`, and `useSheet`. Desktop uses a centred study card without a grabber; touch devices use draggable bottom sheets. Sheet entrance, spring and exit come from the app's common CSS. The header and wide grabber accept dragging; scrolling question content and answering do not dismiss the sheet. An unanswered/incorrect quiz explanation stays visible until dismissal. The final results appear after the final answer sheet closes, and the game pauses behind them.

## Local verification

Run `npm run dev -- --port 3107` and open `/palace-local-qa`. This development-only route uses synthetic study questions and returns 404 outside development. `?large=1` exercises 60 memories; `?isolated=1` uses separate local progress. The route does not bypass authentication or replace the actual grading API. A typed answer requires an authenticated lecture for live AI grading; offline feedback uses the answer guide. Declaring an answer unknown yields zero without an AI call, as the normal grader does.

Checks: `npm test`, `npx tsc --noEmit`, targeted ESLint, and `npm run build`. Palace tests cover deterministic selection and distribution, indoor/outdoor balance, traversable doors in every orientation, road clearance, movement/collision, camera behavior, terrain continuity, saved progress, map projection, clear entrances beneath every skyline style, rooftop planting clearance, and bounded vehicle geometry.

## Surface atlas provenance

Asset: `public/palace/surface-atlas.png`. Generated with the built-in image generation tool, then used as four shared material swatches. The code reduces texture contrast for the final block-style town. The sky is procedural.

Final generation prompt:

> Use case: photorealistic-natural. Asset type: production 3D game surface texture atlas, square 2048x2048 image. Create exactly FOUR equal square seamless material swatches in a strict 2x2 grid, no borders, gaps, labels or text. Each quadrant is an orthographic straight-on flat photographic PBR albedo material, even diffuse neutral illumination, absolutely no perspective, no objects, no cast shadows, no baked directional lighting. Top-left quadrant: warm ivory lime plaster with fine granular weathering and subtle mottling, not cracked or ruined. Top-right: elegant aged beige limestone paving in a regular staggered pattern of small rectangular stones, narrow fine grey mortar, gently varied tones and worn edges. Bottom-left: weathered neutral light grey slate roof tiles with delicately overlapping horizontal courses and fine seams, realistic stone grain. Bottom-right: pale natural oak floor boards, long narrow planks with fine wood grain and subtle knots, straight alignment. All materials should be softly neutral and pale enough to multiply with varied in-game colors. Every quadrant exactly fills one quarter of the entire image, all four quadrants completely flush against each other and outer image boundaries. High detail, photorealistic scanned material quality. No words, symbols, watermark or graphic framing.

The route uses distinct architectural identities, beginning with a spiral skyscraper, a pitched-roof cottage and a moored houseboat. Clock towers and domed observatories break up the taller glass buildings. Building names appear alongside the room or outdoor object in the map and study card, so the exterior silhouette becomes part of the retrieval cue. Houseboats have a bounded water basin, a level gangway, portholes, a mast and deck railings; the existing room footprint and study trigger stay walkable. The clock roof uses a square-based pyramid with eaves that cover the tower corners, verified with geometry raycasts. Notes without sections are grouped once, preventing duplicate memory stops.

Background streets use a separate predominantly low-rise building mix: no background slots are skyscrapers. Townhouses, conservatories, workshops, copper-roof pavilions and windmills add distinct roof silhouettes; terrace and courtyard blocks stay low. Study landmarks retain deterministic named destinations. Each of the spiral, needle and glass skyscrapers appears at most once across the entire town, including large decks; subsequent route cycles use other building families.

The city map shows named destinations and progress, but no longer offers teleport shortcuts. Walk speed is tuned to 7.37 m/s and sprint to 12.21 m/s for controlled exploration. Conservatory roofs now have fitted triangular glass end panels and framing on both ends.

Selecting an uncollected destination prioritizes its marker on the minimap without teleporting. The touch stick only walks, slows for careful doorway movement and stops on release, cancellation or lost pointer capture. Sprinting requires holding Shift; collected ground rings briefly acknowledge completion after the study card closes.

The needle landmark uses three centered, rounded glass volumes with restrained setbacks instead of an offset step on every floor.

A single stepped stone pyramid occupies the unused building lot nearest the town center. Its entrance chamber remains walkable, and placing it never moves or replaces a study destination.
