import { LiveConfigService } from './live-config.service';
import { CameraProfilesService } from '../camera-profiles/camera-profiles.service';

const profiles = [
  { id: 'aaa', camera: { uid: 'UID-A', password: 'pwA', codec: 'h264' } },
  { id: 'bbb', camera: { uid: 'UID-B', password: 'pwB', codec: 'h264' } },
];
const fake = {
  listAllIds: async () => profiles.map((p) => p.id),
  findOneDecryptedForConnection: async (id: string) => profiles.find((p) => p.id === id)!,
} as unknown as CameraProfilesService;

describe('LiveConfigService', () => {
  const svc = new LiveConfigService(fake);

  it('generates a neolink camera block per profile with uid/name/password', async () => {
    const toml = await svc.neolinkConfig();
    expect(toml).toContain('[[cameras]]');
    expect(toml).toContain('name = "aaa"');
    expect(toml).toContain('uid = "UID-A"');
    expect(toml).toContain('password = "pwA"');
    expect(toml).toContain('name = "bbb"');
    expect(toml).toContain('uid = "UID-B"');
  });

  it('generates a go2rtc stream per profile pointing at neolink rtsp', async () => {
    const yaml = await svc.go2rtcConfig();
    expect(yaml).toContain('aaa: rtsp://neolink:8554/aaa');
    expect(yaml).toContain('bbb: rtsp://neolink:8554/bbb');
  });

  it('escapes quotes in a camera password so the TOML stays valid', async () => {
    const trickyFake = {
      listAllIds: async () => ['xyz'],
      findOneDecryptedForConnection: async () => ({
        id: 'xyz',
        camera: { uid: 'UID', password: 'pw"; injected = "x', codec: 'h264' },
      }),
    } as unknown as CameraProfilesService;
    const svc2 = new LiveConfigService(trickyFake);
    const toml = await svc2.neolinkConfig();
    // JSON.stringify escapes the quote → \" — no raw unescaped password quote
    expect(toml).toContain('password = "pw\\"; injected = \\"x"');
  });
});
