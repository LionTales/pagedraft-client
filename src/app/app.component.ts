import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ActivityCenterComponent } from './shared/activity-center/activity-center.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ActivityCenterComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'pagedraft-client';
}
