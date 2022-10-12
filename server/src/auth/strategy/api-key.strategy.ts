import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { AuthService } from '../service/auth.service';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, 'api-key') {
  constructor(private readonly authService: AuthService) {
    super();
  }

  public async validate(req: any): Promise<boolean> {
    const apikey = req.headers.secret;
    const validated = await this.authService.validateApiKey(apikey);

    if (!validated) {
      throw new UnauthorizedException('Invalid api key');
    }
    return validated;
  }
}
