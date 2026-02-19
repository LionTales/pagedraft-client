import { bootstrapApplication } from '@angular/platform-browser';
import { registerLicense } from '@syncfusion/ej2-base';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// TODO: Move this trial key to a secure location before committing.
registerLicense('Ngo9BigBOggjHTQxAR8/V1JGaF5cXGpCf1FpRmJGdld5fUVHYVZUTXxaS00DNHVRdkdlWX1feHVQRGheUUF+WUtWYEs=');

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
