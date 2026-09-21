/** Support tickets (university side) — chat layout. */
import { renderTicketApp } from "/app/pages/ticket-chat.js";

export async function renderTickets(view, ctx) {
  await renderTicketApp(view, ctx, { owner: false });
}
