import { Injectable } from '@nestjs/common';
import { CameraProfilesService } from '../camera-profiles/camera-profiles.service';

@Injectable()
export class LiveConfigService {
  constructor(private readonly profiles: CameraProfilesService) {}

  async neolinkConfig(): Promise<string> {
    const ids = await this.profiles.listAllIds();
    const blocks: string[] = [];
    for (const id of ids) {
      const p = await this.profiles.findOneDecryptedForConnection(id);
      blocks.push(
        [
          '[[cameras]]',
          `name = ${JSON.stringify(id)}`,
          `uid = ${JSON.stringify(p.camera.uid)}`,
          `username = "admin"`,
          `password = ${JSON.stringify(p.camera.password)}`,
        ].join('\n'),
      );
    }
    return ['bind = "0.0.0.0"', 'bind_port = 8554', '', ...blocks, ''].join('\n');
  }

  async go2rtcConfig(): Promise<string> {
    const ids = await this.profiles.listAllIds();
    const lines = ids.map((id) => `  ${id}: rtsp://neolink:8554/${id}`);
    return ['streams:', ...lines, ''].join('\n');
  }
}
