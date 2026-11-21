const PENDING_MESSAGE = "Confirmation pending; return to your booking to check status.";

function pending() {
  return {
    outcome: "confirmation_pending",
    tone: "pending",
    message: PENDING_MESSAGE,
  };
}

/** @param {{ transportError?: boolean, httpStatus?: number, body?: unknown }} options */
export function paymentStatus(options = {}) {
  const { transportError = false, httpStatus, body } = options;
  if (
    transportError ||
    !Number.isInteger(httpStatus) ||
    httpStatus < 200 ||
    httpStatus >= 300 ||
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    body.ok !== true
  ) {
    return pending();
  }

  switch (body.outcome) {
    case "captured_applied":
      return {
        outcome: "captured_applied",
        tone: "success",
        message: "Payment confirmed. You can close this page and return to QuickServe.",
      };
    case "captured_refund_queued":
      return {
        outcome: "captured_refund_queued",
        tone: "warning",
        message: "Payment was captured; a refund is queued. Return to your booking to check status.",
      };
    case "review_required":
      return {
        outcome: "review_required",
        tone: "warning",
        message: "Payment was captured, but needs review. Return to your booking to check status.",
      };
    default:
      return pending();
  }
}
