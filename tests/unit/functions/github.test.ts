import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Octokit } from "octokit";
import {
  createGithubTeam,
  assignIdpGroupsToTeam,
} from "../../../src/api/functions/github.js";
import { GithubError } from "../../../src/common/errors/index.js";
import * as utils from "../../../src/api/utils.js";

// Mock dependencies
vi.mock("octokit");
vi.mock("../../../src/api/utils.js");

describe("createGithubTeam", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const defaultInputs = {
    githubToken: "test-token",
    orgId: "test-org",
    parentTeamId: 123,
    name: "Test Team",
    description: "Test Description",
    privacy: "closed" as const,
    logger: mockLogger,
  };

  let mockOctokit: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOctokit = {
      request: vi.fn(),
    };
    (Octokit as any).mockImplementation(() => mockOctokit);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return existing team ID if team already exists", async () => {
    const existingTeamId = 456;
    mockOctokit.request.mockResolvedValueOnce({
      data: [
        { name: "Other Team", id: 789 },
        { name: "Test Team", id: existingTeamId },
      ],
    });

    const result = await createGithubTeam(defaultInputs);

    expect(result).toBe(existingTeamId);
    expect(mockLogger.info).toHaveBeenCalledWith(
      `Team "Test Team" already exists with id: ${existingTeamId}`
    );
    expect(mockOctokit.request).toHaveBeenCalledTimes(1);
  });

  it("should create new team and remove authenticated user", async () => {
    const newTeamId = 999;
    const authenticatedUser = { login: "test-user" };

    // Mock getting teams (no existing team)
    mockOctokit.request.mockResolvedValueOnce({ data: [] });

    // Mock creating team
    mockOctokit.request.mockResolvedValueOnce({
      status: 201,
      data: { id: newTeamId, slug: "test-team" },
    });

    // Mock getting authenticated user
    mockOctokit.request.mockResolvedValueOnce({ data: authenticatedUser });

    // Mock removing user from team
    mockOctokit.request.mockResolvedValueOnce({});

    const result = await createGithubTeam(defaultInputs);

    expect(result).toBe(newTeamId);
    expect(mockOctokit.request).toHaveBeenCalledWith("POST /orgs/{org}/teams", {
      org: "test-org",
      name: "Test Team",
      description: "[Managed by Core API] Test Description",
      privacy: "closed",
      notification_setting: "notifications_enabled",
      parent_team_id: 123,
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      "Created Github Team with slug test-team"
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      `Successfully removed ${authenticatedUser.login} from team ${newTeamId}`
    );
  });

  it("should create team without description if not provided", async () => {
    const newTeamId = 999;
    const inputsWithoutDescription = { ...defaultInputs };
    delete (inputsWithoutDescription as any).description;

    mockOctokit.request.mockResolvedValueOnce({ data: [] });
    mockOctokit.request.mockResolvedValueOnce({
      status: 201,
      data: { id: newTeamId, slug: "test-team" },
    });
    mockOctokit.request.mockResolvedValueOnce({ data: { login: "test-user" } });
    mockOctokit.request.mockResolvedValueOnce({});

    await createGithubTeam(inputsWithoutDescription);

    expect(mockOctokit.request).toHaveBeenCalledWith(
      "POST /orgs/{org}/teams",
      expect.objectContaining({
        description: "[Managed by Core API]",
      })
    );
  });

  it("should use default privacy 'closed' if not specified", async () => {
    const newTeamId = 999;
    const inputsWithoutPrivacy = { ...defaultInputs };
    delete (inputsWithoutPrivacy as any).privacy;

    mockOctokit.request.mockResolvedValueOnce({ data: [] });
    mockOctokit.request.mockResolvedValueOnce({
      status: 201,
      data: { id: newTeamId, slug: "test-team" },
    });
    mockOctokit.request.mockResolvedValueOnce({ data: { login: "test-user" } });
    mockOctokit.request.mockResolvedValueOnce({});

    await createGithubTeam(inputsWithoutPrivacy);

    expect(mockOctokit.request).toHaveBeenCalledWith(
      "POST /orgs/{org}/teams",
      expect.objectContaining({
        privacy: "closed",
      })
    );
  });

  it("should continue if removing authenticated user fails", async () => {
    const newTeamId = 999;

    mockOctokit.request.mockResolvedValueOnce({ data: [] });
    mockOctokit.request.mockResolvedValueOnce({
      status: 201,
      data: { id: newTeamId, slug: "test-team" },
    });
    mockOctokit.request.mockResolvedValueOnce({ data: { login: "test-user" } });
    mockOctokit.request.mockRejectedValueOnce(new Error("Remove user failed"));

    const result = await createGithubTeam(defaultInputs);

    expect(result).toBe(newTeamId);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      `Failed to remove user from team ${newTeamId}:`,
      expect.any(Error)
    );
  });

  it("should throw GithubError if team creation fails with non-201 status", async () => {
    mockOctokit.request.mockResolvedValueOnce({ data: [] });
    mockOctokit.request.mockResolvedValueOnce({
      status: 400,
      data: { message: "Bad request" },
    });

    await expect(createGithubTeam(defaultInputs)).rejects.toThrow(GithubError);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("should rethrow BaseError instances", async () => {
    const baseError = new GithubError({ message: "Failed to create GitHub team." });
    mockOctokit.request.mockRejectedValueOnce(baseError);

    await expect(createGithubTeam(defaultInputs)).rejects.toThrow(baseError);
  });

  it("should wrap non-BaseError exceptions in GithubError", async () => {
    mockOctokit.request.mockRejectedValueOnce(new Error("Unknown error"));

    await expect(createGithubTeam(defaultInputs)).rejects.toThrow(GithubError);
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to create GitHub team."
    );
  });
});

describe("assignIdpGroupsToTeam", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const defaultInputs = {
    githubToken: "test-token",
    teamId: 123,
    groupsToSync: ["group-1", "group-2"],
    logger: mockLogger,
    orgId: 456,
    orgName: "test-org",
  };

  let mockOctokit: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOctokit = {
      request: vi.fn(),
    };
    (Octokit as any).mockImplementation(() => mockOctokit);
    (utils.sleep as any).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return early if no groups to sync", async () => {
    await assignIdpGroupsToTeam({
      ...defaultInputs,
      groupsToSync: [],
    });

    expect(mockLogger.info).toHaveBeenCalledWith("No IdP groups to sync");
    expect(mockOctokit.request).not.toHaveBeenCalled();
  });

  it("should return early if groupsToSync is undefined", async () => {
    await assignIdpGroupsToTeam({
      ...defaultInputs,
      groupsToSync: undefined as any,
    });

    expect(mockLogger.info).toHaveBeenCalledWith("No IdP groups to sync");
    expect(mockOctokit.request).not.toHaveBeenCalled();
  });

  it("should successfully map IdP groups to team", async () => {
    const mockGroups = [
      {
        group_id: "group-1",
        group_name: "Group One",
        group_description: "First group",
      },
      {
        group_id: "group-2",
        group_name: "Group Two",
        group_description: "Second group",
      },
    ];

    // Mock team sync availability check
    mockOctokit.request.mockResolvedValueOnce({});

    // Mock IdP group searches (successful on first attempt)
    mockOctokit.request
      .mockResolvedValueOnce({
        data: { groups: [mockGroups[0], { group_id: "other" }] },
      })
      .mockResolvedValueOnce({
        data: { groups: [mockGroups[1]] },
      });

    // Mock PATCH request
    mockOctokit.request.mockResolvedValueOnce({});

    await assignIdpGroupsToTeam(defaultInputs);

    expect(mockOctokit.request).toHaveBeenCalledWith(
      "PATCH /organizations/{org}/team/{team_id}/team-sync/group-mappings",
      {
        org: 456,
        team_id: 123,
        groups: mockGroups,
        headers: {
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      "Successfully mapped IdP groups to team 123"
    );
  });

  it("should retry on API errors with exponential backoff", async () => {
    const mockGroup = {
      group_id: "group-1",
      group_name: "Group One",
      group_description: "First group",
    };

    // Mock team sync availability check
    mockOctokit.request.mockResolvedValueOnce({});

    // First attempt throws error, second succeeds
    mockOctokit.request
      .mockRejectedValueOnce(new Error("API Error"))
      .mockResolvedValueOnce({ data: { groups: [mockGroup] } })
      .mockResolvedValueOnce({});

    await assignIdpGroupsToTeam({
      ...defaultInputs,
      groupsToSync: ["group-1"],
    });

    expect(utils.sleep).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Error searching for IdP group"),
      expect.any(Error)
    );
  });

  it("should throw GithubError if IdP group not found after max retries", async () => {
    // Mock team sync availability check
    mockOctokit.request.mockResolvedValueOnce({});

    // All 5 attempts return empty groups
    mockOctokit.request.mockResolvedValue({ data: { groups: [] } });

    await expect(assignIdpGroupsToTeam(defaultInputs)).rejects.toThrow(
      GithubError
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to find IdP group with ID group-1 after 5 retries"
    );
    expect(mockOctokit.request).toHaveBeenCalledTimes(6); // 1 for sync check + 5 retries for first group
  });

  it("should handle IdP groups without description", async () => {
    const mockGroup = {
      group_id: "group-1",
      group_name: "Group One",
      group_description: undefined,
    };

    // Mock team sync availability check
    mockOctokit.request.mockResolvedValueOnce({});

    mockOctokit.request
      .mockResolvedValueOnce({ data: { groups: [mockGroup] } })
      .mockResolvedValueOnce({});

    await assignIdpGroupsToTeam({
      ...defaultInputs,
      groupsToSync: ["group-1"],
    });

    expect(mockOctokit.request).toHaveBeenCalledWith(
      "PATCH /organizations/{org}/team/{team_id}/team-sync/group-mappings",
      expect.objectContaining({
        groups: [
          {
            group_id: "group-1",
            group_name: "Group One",
            group_description: "",
          },
        ],
      })
    );
  });

  it("should rethrow BaseError instances", async () => {
    const baseError = new GithubError({ message: "Failed to assign IdP groups to team 123" });
    mockOctokit.request.mockRejectedValueOnce(baseError);

    await expect(assignIdpGroupsToTeam(defaultInputs)).rejects.toThrow(
      baseError
    );
  });

  it("should wrap non-BaseError exceptions in GithubError", async () => {
    // Mock team sync availability check
    mockOctokit.request.mockResolvedValueOnce({});

    mockOctokit.request
      .mockResolvedValueOnce({
        data: { groups: [{ group_id: "group-1", group_name: "Group One" }] },
      })
      .mockResolvedValueOnce({
        data: { groups: [{ group_id: "group-2", group_name: "Group Two" }] },
      })
      .mockRejectedValueOnce(new Error("Unknown error"));

    await expect(assignIdpGroupsToTeam(defaultInputs)).rejects.toThrow(
      GithubError
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to assign IdP groups to team 123"
    );
  });

  it("should exit gracefully if team sync is not available (404)", async () => {
    // Mock team sync availability check returning 404
    mockOctokit.request.mockRejectedValueOnce({
      status: 404,
      message: "Not Found",
    });

    await assignIdpGroupsToTeam(defaultInputs);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Team sync is not available for team 123")
    );
    expect(mockLogger.warn).toHaveBeenCalledWith("Skipping IdP group assignment");
    // Should not attempt to search for groups or patch
    expect(mockOctokit.request).toHaveBeenCalledTimes(1); // Only sync check
  });

  it("should exit gracefully if PATCH returns 404", async () => {
    const mockGroup = {
      group_id: "group-1",
      group_name: "Group One",
      group_description: "First group",
    };

    // Mock team sync availability check
    mockOctokit.request.mockResolvedValueOnce({});

    // Mock IdP group search
    mockOctokit.request.mockResolvedValueOnce({
      data: { groups: [mockGroup] },
    });

    // Mock PATCH request returning 404
    mockOctokit.request.mockRejectedValueOnce({
      status: 404,
      message: "Not Found",
    });

    await assignIdpGroupsToTeam({
      ...defaultInputs,
      groupsToSync: ["group-1"],
    });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Team sync endpoint not available for team 123. IdP groups were not assigned."
    );
  });
});
