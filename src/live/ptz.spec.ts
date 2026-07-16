import { buildPtzTopic, buildPtzPayload } from './ptz';

describe('ptz message building', () => {
  it('topic is the neolink control topic for the profile', () => {
    expect(buildPtzTopic('cam1')).toBe('neolink/cam1/control/ptz');
  });
  it('payload defaults amount to 32', () => {
    expect(buildPtzPayload('left')).toBe('left 32');
  });
  it('payload honors an explicit amount', () => {
    expect(buildPtzPayload('up', 10)).toBe('up 10');
  });
  it('stop has no amount', () => {
    expect(buildPtzPayload('stop')).toBe('stop');
    expect(buildPtzPayload('stop', 50)).toBe('stop');
  });
});
