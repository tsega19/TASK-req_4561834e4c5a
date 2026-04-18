import '../../../test-setup';
import { TestBed } from '@angular/core/testing';
import { ReviewerPanelComponent } from './reviewer-panel.component';
import { ReviewService } from './review.service';
import { PermissionService } from '../../core/services/permission.service';
import { NotificationService } from '../../core/services/notification.service';
import { DbService } from '../../core/services/db.service';
import { ReviewRecord, TicketRecord, ProjectRecord, CanvasRecord } from '../../core/models/models';

function project(id: string, name: string): ProjectRecord {
  return {
    id, name, description: '', tags: [], pinned: false, featured: false,
    createdAt: 1, updatedAt: 1, createdBy: 'u', canvasCount: 1
  };
}

function canvas(id: string, projectId: string, name: string): CanvasRecord {
  return {
    id, projectId, name, description: '',
    elements: [], connections: [], groups: [],
    viewState: { panX: 0, panY: 0, zoom: 1, gridSize: 20 },
    createdAt: 1, updatedAt: 1, createdBy: 'u', tags: []
  };
}

function review(id: string, canvasId: string, projectId: string, status: 'open' | 'resolved' | 'rejected' = 'open'): ReviewRecord {
  return {
    id, canvasId, projectId, content: 'please review',
    status, createdBy: 'u', createdAt: 10, updatedAt: 10
  };
}

function ticket(id: string, reviewId: string): TicketRecord {
  return {
    id, reviewId, canvasId: 'c1', projectId: 'p1',
    title: 't', description: 'd', priority: 'medium', status: 'open',
    createdBy: 'u', createdAt: 10, updatedAt: 10, attachmentIds: []
  };
}

function mount(opts: {
  projects?: ProjectRecord[];
  canvases?: CanvasRecord[];
  reviews?: ReviewRecord[];
  tickets?: TicketRecord[];
  can?: (p: string) => boolean;
  createReviewError?: Error;
  createTicketError?: Error;
}) {
  TestBed.resetTestingModule();
  const projects = opts.projects ?? [];
  const canvases = opts.canvases ?? [];
  const reviews = opts.reviews ?? [];
  const tickets = opts.tickets ?? [];
  const can = opts.can ?? (() => true);

  const svc = {
    listReviews: jest.fn(async () => reviews),
    listTickets: jest.fn(async () => tickets),
    createReview: jest.fn(async () => {
      if (opts.createReviewError) throw opts.createReviewError;
      return review('new', 'c1', 'p1');
    }),
    createTicket: jest.fn(async () => {
      if (opts.createTicketError) throw opts.createTicketError;
      return ticket('new', reviews[0]?.id ?? 'r1');
    }),
    updateReviewStatus: jest.fn(async () => undefined),
    updateTicketStatus: jest.fn(async () => undefined)
  };

  const db = {
    projects: { all: jest.fn(async () => projects) },
    canvases: { all: jest.fn(async () => canvases) }
  };

  TestBed.configureTestingModule({
    imports: [ReviewerPanelComponent],
    providers: [
      { provide: ReviewService, useValue: svc as unknown as ReviewService },
      { provide: PermissionService, useValue: { can, enforce: jest.fn() } as unknown as PermissionService },
      { provide: NotificationService, useValue: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() } as unknown as NotificationService },
      { provide: DbService, useValue: db as unknown as DbService }
    ]
  });

  return { fixture: TestBed.createComponent(ReviewerPanelComponent), svc };
}

describe('ReviewerPanelComponent', () => {
  it('shows an empty-state message when no reviews are present', async () => {
    const { fixture } = mount({});
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="reviews-empty"]')).not.toBeNull();
  });

  it('renders a card per review with canvas name resolved, plus ticket items', async () => {
    const { fixture } = mount({
      projects: [project('p1', 'Alpha')],
      canvases: [canvas('c1', 'p1', 'Main')],
      reviews: [review('r1', 'c1', 'p1')],
      tickets: [ticket('t1', 'r1')]
    });
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="review-item-r1"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="ticket-item-t1"]')).not.toBeNull();
    expect(el.textContent).toContain('Main');
  });

  it('canvasName falls back to "(deleted)" when the canvas id is unknown', async () => {
    const { fixture } = mount({ canvases: [canvas('c1', 'p1', 'Main')] });
    await fixture.componentInstance.ngOnInit();
    expect(fixture.componentInstance.canvasName('c1')).toBe('Main');
    expect(fixture.componentInstance.canvasName('ghost')).toBe('(deleted)');
  });

  it('canvasesForSelected filters to the chosen project', async () => {
    const { fixture } = mount({
      projects: [project('p1', 'Alpha'), project('p2', 'Beta')],
      canvases: [canvas('c1', 'p1', 'one'), canvas('c2', 'p2', 'two')]
    });
    await fixture.componentInstance.ngOnInit();
    fixture.componentInstance.selectedProjectId = '';
    expect(fixture.componentInstance.canvasesForSelected()).toEqual([]);
    fixture.componentInstance.selectedProjectId = 'p1';
    const hits = fixture.componentInstance.canvasesForSelected().map((c) => c.id);
    expect(hits).toEqual(['c1']);
  });

  it('canSubmitReview requires project + canvas + non-empty content + permission', async () => {
    const { fixture } = mount({ can: (p) => p === 'review.create' });
    const c = fixture.componentInstance;
    expect(c.canSubmitReview()).toBe(false);
    c.selectedProjectId = 'p1';
    c.selectedCanvasId = 'c1';
    c.reviewContent = '   ';
    expect(c.canSubmitReview()).toBe(false);
    c.reviewContent = 'real content';
    expect(c.canSubmitReview()).toBe(true);
  });

  it('canSubmitReview is false when perm denies review.create', async () => {
    const { fixture } = mount({ can: () => false });
    const c = fixture.componentInstance;
    c.selectedProjectId = 'p1';
    c.selectedCanvasId = 'c1';
    c.reviewContent = 'x';
    expect(c.canSubmitReview()).toBe(false);
  });

  it('ticketsFor returns only tickets whose reviewId matches', async () => {
    const { fixture } = mount({
      reviews: [review('r1', 'c1', 'p1')],
      tickets: [ticket('t1', 'r1'), ticket('t2', 'r2')]
    });
    await fixture.componentInstance.ngOnInit();
    const hits = fixture.componentInstance.ticketsFor('r1').map((t) => t.id);
    expect(hits).toEqual(['t1']);
  });

  it('addReview success clears content, toasts, and refreshes', async () => {
    const { fixture, svc } = mount({});
    await fixture.componentInstance.ngOnInit();
    fixture.componentInstance.selectedProjectId = 'p1';
    fixture.componentInstance.selectedCanvasId = 'c1';
    fixture.componentInstance.reviewContent = 'good review';
    await fixture.componentInstance.addReview();
    expect(svc.createReview).toHaveBeenCalled();
    expect(fixture.componentInstance.reviewContent).toBe('');
    const notif = TestBed.inject(NotificationService) as unknown as { success: jest.Mock };
    expect(notif.success).toHaveBeenCalled();
  });

  it('addReview surfaces service errors through the notification service', async () => {
    const { fixture } = mount({ createReviewError: new Error('too short') });
    await fixture.componentInstance.ngOnInit();
    fixture.componentInstance.selectedProjectId = 'p1';
    fixture.componentInstance.selectedCanvasId = 'c1';
    fixture.componentInstance.reviewContent = 'x';
    await fixture.componentInstance.addReview();
    const notif = TestBed.inject(NotificationService) as unknown as { error: jest.Mock };
    expect(notif.error).toHaveBeenCalledWith('too short');
  });

  it('addTicket uses the per-review draft and resets it on success', async () => {
    const r = review('r1', 'c1', 'p1');
    const { fixture, svc } = mount({ reviews: [r] });
    await fixture.componentInstance.ngOnInit();
    fixture.componentInstance.ticketDrafts[r.id] = { title: 't', description: 'd', priority: 'high' };
    await fixture.componentInstance.addTicket(r);
    expect(svc.createTicket).toHaveBeenCalledWith(expect.objectContaining({ reviewId: 'r1', title: 't', priority: 'high' }));
    expect(fixture.componentInstance.ticketDrafts[r.id]).toEqual({ title: '', description: '', priority: 'medium' });
  });

  it('addTicket surfaces service errors via notification.error', async () => {
    const r = review('r1', 'c1', 'p1');
    const { fixture } = mount({ reviews: [r], createTicketError: new Error('bad title') });
    await fixture.componentInstance.ngOnInit();
    fixture.componentInstance.ticketDrafts[r.id] = { title: '', description: 'd', priority: 'low' };
    await fixture.componentInstance.addTicket(r);
    const notif = TestBed.inject(NotificationService) as unknown as { error: jest.Mock };
    expect(notif.error).toHaveBeenCalledWith('bad title');
  });

  it('setReviewStatus / setTicketStatus delegate to the service and refresh', async () => {
    const r = review('r1', 'c1', 'p1');
    const t = ticket('t1', 'r1');
    const { fixture, svc } = mount({ reviews: [r], tickets: [t] });
    await fixture.componentInstance.ngOnInit();
    await fixture.componentInstance.setReviewStatus(r, 'resolved');
    await fixture.componentInstance.setTicketStatus(t, 'done');
    expect(svc.updateReviewStatus).toHaveBeenCalledWith('r1', 'resolved');
    expect(svc.updateTicketStatus).toHaveBeenCalledWith('t1', 'done');
  });
});
