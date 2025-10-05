import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";

export interface GoogleContact {
  email: string;
  upn: string;
  givenName: string;
  familyName: string;
  displayName: string;
}

export interface ExistingContact {
  id: string; // Contact ID for updates/deletes
  contact: GoogleContact;
}

/**
 * Creates a Google API client with domain-wide delegation
 */
export const createGoogleClient = (
  serviceAccountJson: string,
  delegatedUser: string,
): GoogleAuth => {
  const serviceAccountInfo = JSON.parse(serviceAccountJson);

  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccountInfo,
    scopes: ["https://www.google.com/m8/feeds"], // Domain Shared Contacts API scope
    clientOptions: {
      subject: delegatedUser,
    },
  });

  return auth;
};

/**
 * Fetches all domain shared contacts
 */
export const getAllDomainContacts = async (
  auth: GoogleAuth,
  domain: string,
): Promise<Map<string, ExistingContact>> => {
  console.log("Fetching existing domain shared contacts...");
  const contacts = new Map<string, ExistingContact>();

  try {
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    if (!accessToken.token) {
      throw new Error("Failed to get access token");
    }

    // Use the Domain Shared Contacts API
    const feedUrl = `https://www.google.com/m8/feeds/contacts/${domain}/full`;

    let startIndex = 1;
    const maxResults = 1000;
    let hasMore = true;

    while (hasMore) {
      const url = `${feedUrl}?max-results=${maxResults}&start-index=${startIndex}&alt=json`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken.token}`,
          "GData-Version": "3.0",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch contacts: ${response.statusText}`);
      }

      const data = await response.json();
      const entries = data.feed?.entry || [];

      for (const entry of entries) {
        const contact = parseContactEntry(entry);
        if (contact) {
          const key = getPrimaryEmail(contact);
          contacts.set(key, {
            id: getContactId(entry),
            contact,
          });
        }
      }

      // Check if there are more results
      hasMore = entries.length === maxResults;
      startIndex += maxResults;
    }

    console.log(`Found ${contacts.size} existing domain shared contacts`);
    return contacts;
  } catch (error) {
    console.error("Error fetching domain contacts:", error);
    throw error;
  }
};

/**
 * Creates a new domain shared contact
 */
export const createDomainContact = async (
  auth: GoogleAuth,
  domain: string,
  contact: GoogleContact,
): Promise<boolean> => {
  try {
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    if (!accessToken.token) {
      throw new Error("Failed to get access token");
    }

    const feedUrl = `https://www.google.com/m8/feeds/contacts/${domain}/full`;
    const atomEntry = contactToAtomXml(contact);

    const response = await fetch(feedUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
        "GData-Version": "3.0",
        "Content-Type": "application/atom+xml",
      },
      body: atomEntry,
    });

    if (!response.ok) {
      throw new Error(`Failed to create contact: ${response.statusText}`);
    }

    console.log(`Created contact: ${getPrimaryEmail(contact)}`);
    return true;
  } catch (error) {
    console.error(`Error creating contact ${getPrimaryEmail(contact)}:`, error);
    return false;
  }
};

/**
 * Updates an existing domain shared contact
 */
export const updateDomainContact = async (
  auth: GoogleAuth,
  domain: string,
  contactId: string,
  contact: GoogleContact,
): Promise<boolean> => {
  try {
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    if (!accessToken.token) {
      throw new Error("Failed to get access token");
    }

    const editUrl = `https://www.google.com/m8/feeds/contacts/${domain}/full/${contactId}`;
    const atomEntry = contactToAtomXml(contact);

    const response = await fetch(editUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
        "GData-Version": "3.0",
        "Content-Type": "application/atom+xml",
        "If-Match": "*", // Overwrite regardless of version
      },
      body: atomEntry,
    });

    if (!response.ok) {
      throw new Error(`Failed to update contact: ${response.statusText}`);
    }

    console.log(`Updated contact: ${getPrimaryEmail(contact)}`);
    return true;
  } catch (error) {
    console.error(`Error updating contact ${getPrimaryEmail(contact)}:`, error);
    return false;
  }
};

/**
 * Deletes a domain shared contact
 */
export const deleteDomainContact = async (
  auth: GoogleAuth,
  domain: string,
  contactId: string,
  email: string,
): Promise<boolean> => {
  try {
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    if (!accessToken.token) {
      throw new Error("Failed to get access token");
    }

    const editUrl = `https://www.google.com/m8/feeds/contacts/${domain}/full/${contactId}`;

    const response = await fetch(editUrl, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
        "GData-Version": "3.0",
        "If-Match": "*",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to delete contact: ${response.statusText}`);
    }

    console.log(`Deleted contact: ${email}`);
    return true;
  } catch (error) {
    console.error(`Error deleting contact ${email}:`, error);
    return false;
  }
};

/**
 * Converts a contact to Atom XML format for Google's API
 */
const contactToAtomXml = (contact: GoogleContact): string => {
  const emails: string[] = [];

  if (contact.email) {
    emails.push(
      `<gd:email rel="http://schemas.google.com/g/2005#work" address="${escapeXml(contact.email)}" primary="true" />`,
    );
  }

  if (
    contact.upn &&
    contact.upn.toLowerCase() !== contact.email.toLowerCase()
  ) {
    emails.push(
      `<gd:email rel="http://schemas.google.com/g/2005#other" address="${escapeXml(contact.upn)}" />`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<atom:entry xmlns:atom="http://www.w3.org/2005/Atom" xmlns:gd="http://schemas.google.com/g/2005">
  <atom:category scheme="http://schemas.google.com/g/2005#kind" term="http://schemas.google.com/contact/2008#contact" />
  <gd:name>
    <gd:givenName>${escapeXml(contact.givenName)}</gd:givenName>
    <gd:familyName>${escapeXml(contact.familyName)}</gd:familyName>
    <gd:fullName>${escapeXml(contact.displayName)}</gd:fullName>
  </gd:name>
  ${emails.join("\n  ")}
</atom:entry>`;
};

/**
 * Parses a contact entry from the API response
 */
const parseContactEntry = (entry: any): GoogleContact | null => {
  const emails = entry.gd$email || [];
  if (emails.length === 0) {
    return null;
  }

  const primaryEmail =
    emails.find((e: any) => e.primary === "true")?.address || emails[0].address;
  const otherEmail =
    emails.find((e: any) => e.rel?.includes("other"))?.address || "";

  const name = entry.gd$name || {};

  return {
    email: primaryEmail || "",
    upn: otherEmail || "",
    givenName: name.gd$givenName?.$t || "",
    familyName: name.gd$familyName?.$t || "",
    displayName: name.gd$fullName?.$t || primaryEmail || "",
  };
};

/**
 * Extracts the contact ID from an entry
 */
const getContactId = (entry: any): string => {
  const id = entry.id?.$t || "";
  // Extract the last part of the ID (after the last /)
  return id.split("/").pop() || id;
};

/**
 * Gets the primary email identifier for a contact
 */
const getPrimaryEmail = (contact: GoogleContact): string => {
  return (contact.email || contact.upn).toLowerCase();
};

/**
 * Escapes XML special characters
 */
const escapeXml = (str: string): string => {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};
