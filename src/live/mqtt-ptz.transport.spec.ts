import { EventEmitter } from 'node:events';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'mqtt';
import { MqttPtzTransport } from './mqtt-ptz.transport';

jest.mock('mqtt', () => ({ connect: jest.fn() }));

class FakeMqttClient extends EventEmitter {
  connected = false;
  publish = jest.fn(
    (_topic: string, _payload: string, cb: (err?: Error) => void) => cb(),
  );
  end = jest.fn((_force: boolean, _opts: object, cb: () => void) => cb());
}

describe('MqttPtzTransport', () => {
  let client: FakeMqttClient;
  let transport: MqttPtzTransport;

  beforeEach(() => {
    client = new FakeMqttClient();
    (connect as jest.Mock).mockReturnValue(client);
    const config = { getOrThrow: jest.fn().mockReturnValue('mqtt://test:1883') };
    transport = new MqttPtzTransport(config as unknown as ConfigService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('connects with queueQoSZero disabled so offline publishes fail instead of queueing', async () => {
    client.connected = true;
    await transport.send('p1', 'left', 32);
    expect(connect).toHaveBeenCalledWith('mqtt://test:1883', { queueQoSZero: false });
  });

  it('publishes the neolink topic and payload when connected', async () => {
    client.connected = true;
    await transport.send('p1', 'left', 32);
    expect(client.publish).toHaveBeenCalledWith('neolink/p1/control/ptz', 'left 32', expect.any(Function));
  });

  it('waits for the connect event, then publishes', async () => {
    const pending = transport.send('p1', 'stop');
    expect(client.publish).not.toHaveBeenCalled();
    client.connected = true;
    client.emit('connect');
    await pending;
    expect(client.publish).toHaveBeenCalledWith('neolink/p1/control/ptz', 'stop', expect.any(Function));
  });

  it('rejects 503 instead of hanging when the broker never connects', async () => {
    jest.useFakeTimers();
    const pending = transport.send('p1', 'up');
    const assertion = expect(pending).rejects.toBeInstanceOf(ServiceUnavailableException);
    await jest.advanceTimersByTimeAsync(3_001);
    await assertion;
    expect(client.publish).not.toHaveBeenCalled();
    expect(client.listenerCount('connect')).toBe(0); // timeout path removes its listener
  });

  it('maps a publish error to 503 without leaking the broker error', async () => {
    client.connected = true;
    client.publish.mockImplementation((_t: string, _p: string, cb: (err?: Error) => void) =>
      cb(new Error('internal broker detail')),
    );
    await expect(transport.send('p1', 'up')).rejects.toMatchObject({
      message: expect.not.stringContaining('internal broker detail'),
      status: 503,
    });
  });
});
