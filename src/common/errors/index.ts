interface BaseErrorParams<T extends string> {
  name: T;
  id: number;
  message: string;
  httpStatusCode: number;
}

export abstract class BaseError<T extends string> extends Error {
  public name: T;

  public id: number;

  public message: string;

  public httpStatusCode: number;

  constructor({ name, id, message, httpStatusCode }: BaseErrorParams<T>) {
    super(message || name || "Error");
    this.name = name;
    this.id = id;
    this.message = message;
    this.httpStatusCode = httpStatusCode;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toString() {
    return `Error ${this.id} (${this.name}): ${this.message}\n\n${this.stack}`;
  }
  toJson() {
    return {
      error: true,
      name: this.name,
      id: this.id,
      message: this.message,
    };
  }
}

export class NotImplementedError extends BaseError<"NotImplementedError"> {
  constructor({ message }: { message?: string }) {
    super({
      name: "NotImplementedError",
      id: 100,
      message: message || "This feature has not been implemented yet.",
      httpStatusCode: 500,
    });
  }
}

export class UnauthorizedError extends BaseError<"UnauthorizedError"> {
  constructor({ message }: { message: string }) {
    super({ name: "UnauthorizedError", id: 101, message, httpStatusCode: 401 });
  }
}

export class UnauthenticatedError extends BaseError<"UnauthenticatedError"> {
  constructor({ message }: { message: string }) {
    super({
      name: "UnauthenticatedError",
      id: 102,
      message,
      httpStatusCode: 403,
    });
  }
}

export class InternalServerError extends BaseError<"InternalServerError"> {
  constructor({ message }: { message?: string } = {}) {
    super({
      name: "InternalServerError",
      id: 100,
      message:
        message ||
        "An internal server error occurred. Please try again or contact support.",
      httpStatusCode: 500,
    });
  }
}

export class NotFoundError extends BaseError<"NotFoundError"> {
  constructor({ endpointName }: { endpointName: string }) {
    super({
      name: "NotFoundError",
      id: 103,
      message: `${endpointName} is not a valid URL.`,
      httpStatusCode: 404,
    });
  }
}

export class ValidationError extends BaseError<"ValidationError"> {
  constructor({ message }: { message: string }) {
    super({
      name: "ValidationError",
      id: 104,
      message,
      httpStatusCode: 400,
    });
  }
}

export class DatabaseInsertError extends BaseError<"DatabaseInsertError"> {
  constructor({ message }: { message: string }) {
    super({
      name: "DatabaseInsertError",
      id: 105,
      message,
      httpStatusCode: 500,
    });
  }
}

export class DatabaseFetchError extends BaseError<"DatabaseFetchError"> {
  constructor({ message }: { message: string }) {
    super({
      name: "DatabaseFetchError",
      id: 106,
      message,
      httpStatusCode: 500,
    });
  }
}

export class DiscordEventError extends BaseError<"DiscordEventError"> {
  constructor({ message }: { message?: string }) {
    super({
      name: "DiscordEventError",
      id: 107,
      message: message || "Could not create Discord event.",
      httpStatusCode: 500,
    });
  }
}

export class EntraInvitationError extends BaseError<"EntraInvitationError"> {
  email: string;
  constructor({ message, email }: { message?: string; email: string }) {
    super({
      name: "EntraInvitationError",
      id: 108,
      message: message || "Could not invite user to Entra ID.",
      httpStatusCode: 500,
    });
    this.email = email;
  }
}

export class TicketNotFoundError extends BaseError<"TicketNotFoundError"> {
  constructor({ message }: { message?: string }) {
    super({
      name: "TicketNotFoundError",
      id: 108,
      message: message || "Could not find the ticket presented.",
      httpStatusCode: 404,
    });
  }
}

export class TicketNotValidError extends BaseError<"TicketNotValidError"> {
  constructor({ message }: { message?: string }) {
    super({
      name: "TicketNotValidError",
      id: 109,
      message: message || "Ticket presented was found but is not valid.",
      httpStatusCode: 400,
    });
  }
}

export class NotSupportedError extends BaseError<"NotSupportedError"> {
  constructor({ message }: { message?: string }) {
    super({
      name: "NotSupportedError",
      id: 110,
      message: message || "This operation is not supported.",
      httpStatusCode: 400,
    });
  }
}
