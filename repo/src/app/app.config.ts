import { APP_INITIALIZER, ApplicationConfig, importProvidersFrom, isDevMode } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { FormsModule } from '@angular/forms';
import { routes } from './app.routes';
import { AuthService } from './core/services/auth.service';
import { DbService } from './core/services/db.service';
import { LoggerService } from './logging/logger.service';

// Session restoration must complete before the router's initial navigation so
// authGuard sees the restored session on direct URL entry (e.g. a second tab
// opening a canvas URL). APP_INITIALIZER blocks bootstrap until resolved.
export function initializeApp(db: DbService, auth: AuthService, logger: LoggerService): () => Promise<void> {
  return async () => {
    try {
      await db.init();
      await auth.bootstrapSeed();
      auth.restoreSession();
    } catch (e) {
      logger.error('app', 'init', 'initialization failed', { error: String(e) });
    }
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withHashLocation()),
    importProvidersFrom(FormsModule),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    }),
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: initializeApp,
      deps: [DbService, AuthService, LoggerService]
    }
  ]
};
