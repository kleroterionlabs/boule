// src/github/queries.ts — read-side GraphQL documents (no client logic).

export const REPO_ID = /* GraphQL */ `
query RepoId($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { id }
}`;

export const SEARCH_BY_BOULE_ID = /* GraphQL */ `
query SearchByBouleId($q: String!) {
  search(query: $q, type: ISSUE, first: 1) {
    nodes { ... on Issue { number nodeId: id url body } }
  }
}`;

export const PROJECT_SCHEMA = /* GraphQL */ `
query ProjectSchema($projectId: ID!) {
  node(id: $projectId) {
    ... on ProjectV2 {
      fields(first: 30) {
        nodes {
          ... on ProjectV2Field { id name }
          ... on ProjectV2SingleSelectField { id name options { id name } }
          ... on ProjectV2IterationField { id name configuration { iterations { id startDate } } }
        }
      }
    }
  }
}`;

export const DISCUSSION_CATEGORIES_QUERY = /* GraphQL */ `
query Categories($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    id
    discussionCategories(first: 25) { nodes { id name isAnswerable } }
  }
}`;

// Strongly-consistent list (NOT search) — scan recent discussions in a category for a boule marker.
export const DISCUSSIONS_IN_CATEGORY = /* GraphQL */ `
query DiscussionsInCategory($owner: String!, $name: String!, $categoryId: ID!) {
  repository(owner: $owner, name: $name) {
    discussions(first: 25, categoryId: $categoryId, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number nodeId: id url body }
    }
  }
}`;

export const ORG_ISSUE_TYPES = /* GraphQL */ `
query OrgTypes($org: String!) {
  organization(login: $org) { id issueTypes(first: 25) { nodes { id name } } }
}`;

// Owner-agnostic: a Projects v2 board may belong to an Organization OR a User.
export const PROJECT_BY_OWNER = /* GraphQL */ `
query ProjectByOwner($login: String!, $number: Int!) {
  repositoryOwner(login: $login) {
    ... on Organization { projectV2(number: $number) { id } }
    ... on User { projectV2(number: $number) { id } }
  }
}`;

export const OWNER_ID = /* GraphQL */ `
query OwnerId($login: String!) { repositoryOwner(login: $login) { id } }`;

// Full single-select options (incl. color + description) — needed to re-send them on an options merge.
export const SELECT_FIELD_OPTIONS = /* GraphQL */ `
query FieldOptions($projectId: ID!, $name: String!) {
  node(id: $projectId) {
    ... on ProjectV2 {
      field(name: $name) {
        ... on ProjectV2SingleSelectField { id options { id name color description } }
      }
    }
  }
}`;
