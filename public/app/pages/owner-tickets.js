/** Owner inbox for university tickets — same chat layout, owner actions. */
import { renderTicketApp } from "/app/pages/ticket-chat.js";

export async function renderOwnerTickets(view, ctx) {
  await renderTicketApp(view, ctx, { owner: true });
}
