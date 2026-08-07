import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppDockComponent } from './shared/app-dock/app-dock.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, AppDockComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'pagedraft-client';
}
