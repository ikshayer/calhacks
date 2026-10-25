/**
 * Asks Claude (Opus 5.5) to write the "reworked" Giving Garden video as a Remotion composition.
 *
 *   npm run video:generate            (from backend/worker; reads ANTHROPIC_API_KEY from the repo-root .env)
 *   FEEDBACK="the calendar covers the caption" npm run video:generate   (a second pass with notes)
 *
 * Writes videos/src/GivingGardenReworked.tsx. Nothing here renders; `npm run render:reworked` in
 * videos/ does that. Photos are sent as small previews so Claude can place text and choose focal points.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MODEL = 'claude-opus-5-5';
const OUT = fileURLToPath(new URL('../../../videos/src/GivingGardenReworked.tsx', import.meta.url));
const PREVIEWS = process.env.PREVIEW_DIR;

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY in .env');
if (!PREVIEWS) throw new Error('Set PREVIEW_DIR to the folder holding p1.jpg..p8.jpg previews');

const PHOTOS: { id: string; file: string; orientation: 'landscape' | 'portrait'; shows: string }[] = [
  { id: 'p1', file: 'photos/p1.jpg', orientation: 'landscape', shows: 'Garden overview: picket fence, green shed, red shed, greenhouse tunnel, big trees, gravel drive. Sunny.' },
  { id: 'p2', file: 'photos/p2.jpg', orientation: 'landscape', shows: 'Raised beds full of leafy plants and orange flowers, trees behind.' },
  { id: 'p3', file: 'photos/p3.jpg', orientation: 'portrait', shows: 'An older man in a cap and green shirt looking at a mobile chicken coop (the person is at the left edge).' },
  { id: 'p4', file: 'photos/p4.jpg', orientation: 'portrait', shows: 'Chicks in a wooden brooder, seen through a window. Small and yellow.' },
  { id: 'p5', file: 'photos/p5.jpg', orientation: 'portrait', shows: 'Long raised beds with netting, big sky and clouds, utility pole.' },
  { id: 'p6', file: 'photos/p6.jpg', orientation: 'landscape', shows: 'Several hens in a coop run: black, speckled, golden.' },
  { id: 'p7', file: 'photos/p7.jpg', orientation: 'landscape', shows: 'A smiling young volunteer in a grey shirt pointing at hens in the coop (person at the left).' },
  { id: 'p8', file: 'photos/p8.jpg', orientation: 'portrait', shows: 'A smiling young volunteer in a grey shirt holding a brown hen, face in the upper middle of the frame.' },
];

const SYSTEM = `You are a senior motion designer and Remotion engineer. You write one React + TypeScript file that Remotion renders to a 20 second vertical video. Output only code.`;

const BRIEF = `
Write videos/src/GivingGardenReworked.tsx for The Giving Garden, a nonprofit farm in Parker, Texas.

GOAL: attract volunteers to help with the harvest and distribution on Friday, October 30. Research on similar nonprofit accounts found: a real person up front beat a logo; volunteers plus a single clear ask did best; a concrete date and place helped; the best reels ran 20-35 seconds. So: one hook, one intro, one ask, one call to action.

TECHNICAL CONTRACT (the file must compile exactly like this):
- Export a named component: export const GivingGardenReworked: React.FC = () => { ... } (no props).
- Import only from 'react' and 'remotion'. No other packages, no CSS files, no fonts to download (use Georgia, serif for display text and system-ui, sans-serif for small text).
- Composition is 1080 x 1920, 30 fps, exactly 600 frames. Do not call useVideoConfig to change duration; assume those numbers.
- Everything must be a pure function of useCurrentFrame(): no Math.random, Date, CSS transitions, CSS animations or setTimeout. Use interpolate, spring and Easing from remotion.
- Show photos with <Img src={staticFile('photos/pN.jpg')} /> from remotion (not <img>). The photos exist: ${PHOTOS.map((p) => `${p.id} (${p.orientation})`).join(', ')}.
- No <Audio>. Text and visuals only.
- Strict TypeScript: no any, no @ts-ignore.
- Keep important text inside a safe area: 90px side margins, nothing important in the top 200px or bottom 300px (platform UI covers them).

THE FIVE BEATS (frames at 30 fps) AND THE EXACT ON-SCREEN TEXT. Use this wording verbatim. Do not add claims, numbers, names or quotes of your own:
1. HOOK, frames 0-90 (0-3s). Photo p8 (volunteer holding a hen). Text: "He came out to the farm." then "You can too." (second line appears about 1s after the first).
2. INTRO, frames 90-240 (3-8s). Photo p1, then p2 crossfading in. Small line "THE GIVING GARDEN" and larger line "A nonprofit farm in Parker, TX". Include one SVG illustration that draws itself with stroke-dashoffset (a sprout: stem plus two leaves).
3. WHAT'S HERE, frames 240-390 (8-13s). Photos p4 (chicks) then p6 (hens). Text: "We grow sustainable food for our community."
4. THE ASK, frames 390-510 (13-17s). Photo p5 or p2. Text: "Harvest day" and "Friday, Oct 30" and "Volunteers needed". Include a calendar-page flip (SVG or divs with rotateX driven by frame) landing on "30".
5. CALL TO ACTION, frames 510-600 (17-20s). Photo p1 (or p7 if it works better). Text: "Come to" then "4308 Church Lane" and "Parker, TX 75002" and "Bring a friend." Include a map-pin SVG that drops in with a spring and a ripple ring.

LOOK: warm documentary. Photos fill the frame (object-fit cover; choose objectPosition per photo so faces and subjects stay in frame; for portrait photos in a portrait frame this is easy, for landscape photos crop to the most interesting part). Slow Ken Burns push (scale 1.00 to about 1.12, small drift) on every photo. 10-frame crossfades between beats. A soft dark gradient scrim behind text so cream text (#fdfbf3) stays legible on bright sky. Accent colour sun yellow #f2b53c, deep green #2f5d3a. Text springs in with a small upward slide; stagger multiple lines by 6-8 frames; fade text out in the last 6 frames of each beat. Large type: the main line of each beat is at least 84px.

Return a single \`\`\`tsx code block and nothing else.`;

function loadPreview(id: string): Anthropic.ImageBlockParam {
  const path = `${PREVIEWS}/${id}.jpg`;
  if (!existsSync(path)) throw new Error(`Missing preview ${path}`);
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: readFileSync(path).toString('base64') } };
}

const feedback = process.env.FEEDBACK?.trim();
const previousCode = feedback && existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;

const content: Anthropic.ContentBlockParam[] = [];
for (const photo of PHOTOS) {
  content.push({ type: 'text', text: `${photo.id} (${photo.orientation}): ${photo.shows}` });
  content.push(loadPreview(photo.id));
}
content.push({ type: 'text', text: BRIEF });
if (previousCode && feedback) {
  content.push({
    type: 'text',
    text: `This is your previous version:\n\`\`\`tsx\n${previousCode}\n\`\`\`\nFix these problems, keep everything else the same, and return the whole file:\n${feedback}`,
  });
}

const client = new Anthropic({ apiKey });

let message: Anthropic.Message;
try {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  });
  message = await stream.finalMessage();
} catch (error) {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    throw new Error(`Anthropic rejected the API key (${error.status}): ${error.message}`);
  }
  throw error;
}

if (message.stop_reason === 'max_tokens') throw new Error('Claude ran out of tokens before finishing the file.');
const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
const blocks = [...text.matchAll(/```(?:tsx|typescript|ts)?\n([\s\S]*?)```/g)];
if (blocks.length !== 1) throw new Error(`Expected exactly one code block, got ${blocks.length}.`);
const code = blocks[0]?.[1];
if (!code || !code.includes('export const GivingGardenReworked')) {
  throw new Error('The code block does not export GivingGardenReworked.');
}

writeFileSync(OUT, code);
console.log(`Wrote ${OUT}`);
console.log(`Model ${message.model}; tokens in ${message.usage.input_tokens}, out ${message.usage.output_tokens}`);
