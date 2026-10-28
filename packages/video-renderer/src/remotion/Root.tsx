import { Composition, type CalculateMetadataFunction } from 'remotion';
import {
  REELS_SAFE_AREA,
  RenderInputSchema,
  projectDurationInFrames,
  type RenderInput,
} from '@kampora/shared';
import { COMPOSITION_ID, KamporaAd } from './KamporaAd';

/** Asset-free sample so Remotion Studio opens without a database or storage. */
const studioSample: RenderInput = {
  scale: 1,
  assetUrls: {},
  project: {
    schemaVersion: 1,
    id: 'studio-sample',
    title: 'Studio sample',
    locale: 'he-IL',
    direction: 'rtl',
    output: { width: 1080, height: 1920, fps: 30, codec: 'h264', crf: 20 },
    safeArea: REELS_SAFE_AREA,
    branding: {
      businessName: 'Luz',
      colors: {
        primary: '#2B1B12',
        secondary: '#C8743A',
        accent: '#F2C14E',
        background: '#FBF5EC',
        text: '#1C140F',
      },
      fontFamily: 'Heebo',
    },
    assets: [],
    scenes: [
      {
        id: 's1',
        sourceSceneKey: 'hook',
        durationInFrames: 90,
        visual: { type: 'motion-graphics', template: 'brand-gradient' },
        overlays: [{ type: 'headline', text: 'רגע, ראיתם את המבצע ב-Luz?', position: 'top' }],
        caption: { text: 'רגע, ראיתם את המבצע ב-Luz?' },
        transition: { type: 'fade', durationInFrames: 6 },
      },
      {
        id: 's2',
        sourceSceneKey: 'offer',
        durationInFrames: 120,
        visual: { type: 'motion-graphics', template: 'offer-card' },
        overlays: [{ type: 'price-tag', price: '29.90 ₪', label: 'קפה + מאפה' }],
        caption: { text: 'עכשיו: קפה + מאפה ב-29.90 ₪ עד סוף החודש.' },
        transition: { type: 'zoom', durationInFrames: 10 },
      },
      {
        id: 's3',
        sourceSceneKey: 'cta',
        durationInFrames: 120,
        visual: { type: 'motion-graphics', template: 'brand-gradient' },
        overlays: [
          { type: 'logo' },
          { type: 'cta', text: 'בואו לנצל את המבצע', subtext: 'פלורנטין 12, תל אביב' },
        ],
        caption: { text: 'בואו לנצל את המבצע – פלורנטין 12, תל אביב.' },
        transition: { type: 'slide-up', durationInFrames: 10 },
      },
    ],
    audio: {},
    captions: { enabled: true, maxWordsPerChunk: 4 },
  },
};

const calculateMetadata: CalculateMetadataFunction<RenderInput> = ({ props }) => {
  const input = RenderInputSchema.parse(props);
  return {
    durationInFrames: projectDurationInFrames(input.project),
    fps: input.project.output.fps,
    width: input.project.output.width,
    height: input.project.output.height,
    props: input,
  };
};

export function RemotionRoot() {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={KamporaAd}
      durationInFrames={330}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={studioSample}
      calculateMetadata={calculateMetadata}
    />
  );
}
