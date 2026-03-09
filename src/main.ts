import { bootstrapApplication } from '@angular/platform-browser';
import { registerLicense, L10n } from '@syncfusion/ej2-base';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// TODO: Move this trial key to a secure location before committing.
registerLicense('Ngo9BigBOggjHTQxAR8/V1JGaF5cXGpCf1FpRmJGdld5fUVHYVZUTXxaS00DNHVRdkdlWX1feHVQRGheUUF+WUtWYEs=');

// Hebrew locale for Document Editor (RTL, dialogs).
L10n.load({
  he: {
    documenteditor: {
      'Right-to-left': 'ימין לשמאל',
      'Left-to-right': 'שמאל לימין',
      'Direction': 'כיוון',
      'Paragraph': 'פסקה',
      'Table': 'טבלה',
      'Ok': 'אישור',
      'Cancel': 'ביטול'
    }
  }
});

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
