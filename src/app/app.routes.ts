import { Routes } from '@angular/router';
import { editorCanDeactivate } from './features/editor/editor-can-deactivate.guard';
import { feedbackTriageCanMatch } from './features/feedback-triage/feedback-triage.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'books', pathMatch: 'full' },
  { path: 'books', loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent) },
  {
    path: 'books/:bookId',
    loadComponent: () => import('./features/editor/editor-page.component').then(m => m.EditorPageComponent),
    canDeactivate: [editorCanDeactivate]
  },
  { path: 'books/:bookId/import', loadComponent: () => import('./features/import/import-page.component').then(m => m.ImportPageComponent) },
  // Wave 3 / w4: export is a ROUTE, a sibling of import, so the spine's Export stage has a real destination
  // and the served guides can name a URL. A dialog would have had neither.
  { path: 'books/:bookId/export', loadComponent: () => import('./features/export/export-page.component').then(m => m.ExportPageComponent) },
  // Chatbot phase A.2 / c1: the guides reader. APP-LEVEL and deliberately not book-scoped - the guides
  // describe the product, not a manuscript, and the assistant that cites them is reachable from every
  // route including ones where no book is open. `/help` is the index; `/help/:guideId` is one guide,
  // and it is where the chat's citation chips navigate. The `lang` query parameter carries the language
  // on both, so a shared link keeps the language it was read in.
  { path: 'help', loadComponent: () => import('./features/help/help-index.component').then(m => m.HelpIndexComponent) },
  { path: 'help/:guideId', loadComponent: () => import('./features/help/guide-reader.component').then(m => m.GuideReaderComponent) },
  // Show C2: the OWNER's feedback triage. App-level, like `/help`, because a vote can be cast from any
  // route and the rows are not scoped to a book.
  //
  // `canMatch`, NOT `canActivate`, and the difference is what "flag off = no route" means literally: with
  // `Feedback:TriageEnabled` false the guard returns false, this entry does not match, the lazy chunk is
  // never fetched, and the URL falls through to the wildcard below exactly as an unknown URL does. That
  // is the client-side mirror of the server answering a plain bodiless 404 rather than a 403. The guard
  // learns the flag from the deliberately ungated `/api/feedback/availability`; see the guard's own doc
  // for why probing a gated endpoint could not work.
  {
    path: 'feedback',
    canMatch: [feedbackTriageCanMatch],
    loadComponent: () =>
      import('./features/feedback-triage/feedback-triage.component').then(m => m.FeedbackTriageComponent)
  },
  { path: '**', redirectTo: 'books' }
];
