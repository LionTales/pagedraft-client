import { APP_INITIALIZER, ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { routes } from './app.routes';
import { BookProfileContinuationService } from './core/services/book-profile-continuation.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(),
    {
      // c04. `BookProfileContinuationService` watches the job registry for briefs builds reaching their
      // terminal and runs the book-profile continuation off them, so the profile is built even when no
      // dashboard, panel or status row is mounted to see it happen. A root-provided service is only
      // constructed on first injection, so without this it would start listening at the moment some
      // component happened to want it - i.e. exactly the "only if somebody is watching" coupling it was
      // written to remove. Instantiated at bootstrap; it registers its listener in its constructor and
      // does nothing else here.
      provide: APP_INITIALIZER,
      multi: true,
      deps: [BookProfileContinuationService],
      useFactory: () => () => {},
    },
  ]
};
