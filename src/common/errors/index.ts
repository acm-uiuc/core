interface BaseErrorParams<T extends string> {
  name: T;
  id: number;
  message: string;
  httpStatusCode: number;
  internalLog?: string;
}

export abstract class BaseError<T extends string> extends Error {
  public name: T;

  public id: number;

  public message: string;

  public httpStatusCode: number;

  public internalLog: string | undefined;

  constructor({ name, id, message, httpStatusCode, internalLog }: BaseErrorParams<T>) {
    super(message || name || "Error");
    this.name = name;
    this.id = id;
    this.message = message;
    this.httpStatusCode = httpStatusCode;
    this.internalLog = internalLog;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toString() {
    return `Error ${this.id} (${this.name}): ${this.message}${this.internalLog ? `\n\nInternal Message: ${this.internalLog}` : ''}\n\n${this.stack}`;
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
  constructor({ message }: { message?: string }) {
    super({ name: "UnauthorizedError", id: 101, message: message || "User does not have the privileges for this task.", httpStatusCode: 401 });
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
  constructor({ message, internalLog }: { message?: string, internalLog?: string } = {}) {
    super({
      name: "InternalServerError",
      id: 100,
      message:
        message ||
        "An internal server error occurred. Please try again or contact support.",
      httpStatusCode: 500,
      internalLog
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
      httpStatusCode: 400,
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

export class DatabaseDeleteError extends BaseError<"DatabaseDeleteError"> {
  constructor({ message }: { message: string }) {
    super({
      name: "DatabaseDeleteError",
      id: 111,
      message,
      httpStatusCode: 500,
    });
  }
}

export class StoreItemNotFoundError extends BaseError<"StoreItemNotFoundError"> {
  constructor({ message }: { message?: string }) {
    super({
      name: "StoreItemNotFoundError",
      id: 112,
      message: message || "Could not find the store item requested.",
      httpStatusCode: 404,
    });
  }
}

export class StoreItemOutOfStockError extends BaseError<"StoreItemOutOfStockError"> {
  constructor({ message }: { message?: string }) {
    super({
      name: "StoreItemOutOfStockError",
      id: 113,
      message: message || "Store item found but out of stock.",
      httpStatusCode: 400,
    });
  }
}

export class StoreItemNotSellTimeError extends BaseError<"StoreItemNotSellTimeError"> {
  constructor({ message }: { message?: string }) {
    super({
      name: "StoreItemNotSellTimeError",
      id: 114,
      message: message || "Store item found but not at selling time.",
      httpStatusCode: 400,
    });
  }
}

export class EntraGroupError extends BaseError<"EntraGroupError"> {
  group: string;
  constructor({
    code,
    message,
    group,
  }: {
    code?: number;
    message?: string;
    group: string;
  }) {
    super({
      name: "EntraGroupError",
      id: 308,
      message:
        message || `Could not modify the group membership for group ${group}.`,
      httpStatusCode: code || 500,
    });
    this.group = group;
  }
}

export class EntraGroupsFromEmailError extends BaseError<"EntraGroupsFromEmailError"> {
  email: string;
  constructor({
    code,
    message,
    email
  }: {
    code?: number;
    message?: string;
    email: string
  }) {
    super({
      name: "EntraGroupsFromEmailError",
      id: 309, //TODO: What should this be?
      message: message || `Could not fetch the groups for user ${email}.`,
      httpStatusCode: code || 500
    });
    this.email = email;
  }
};

export class EntraFetchError extends BaseError<"EntraFetchError"> {
  email: string;
  constructor({ message, email }: { message?: string; email: string }) {
    super({
      name: "EntraFetchError",
      id: 509,
      message: message || "Could not get data from Entra ID.",
      httpStatusCode: 500,
    });
    this.email = email;
  }
}

export class EntraPatchError extends BaseError<"EntraPatchError"> {
  email: string;
  constructor({ message, email }: { message?: string; email: string }) {
    super({
      name: "EntraPatchError",
      id: 510,
      message: message || "Could not set data at Entra ID.",
      httpStatusCode: 500,
    });
    this.email = email;
  }
}

export abstract class InternalError<T extends string> extends Error {
  public name: T;

  public id: number;

  public message: string;


  constructor({ name, id, message }: Omit<BaseErrorParams<T>, "httpStatusCode">) {
    super(message || name || "Error");
    this.name = name;
    this.id = id;
    this.message = message;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toString() {
    return `Error ${this.id} (${this.name}): ${this.message}\n\n${this.stack}`;
  }
}

export class EncryptionError extends InternalError<"EncryptionError"> {
  constructor({ message }: { message?: string; }) {
    super({
      name: "EncryptionError",
      id: 601,
      message: message || "Could not encrypt data.",
    });
  }
}

export class DecryptionError extends InternalError<"DecryptionError"> {
  constructor({ message }: { message?: string; }) {
    super({
      name: "DecryptionError",
      id: 602,
      message: message || "Could not decrypt data.",
    });
  }
}

export class GithubError extends InternalError<"GithubError"> {
  constructor({ message }: { message?: string; }) {
    super({
      name: "GithubError",
      id: 701,
      message: message || "Could not update Github state.",
    });
  }
}
