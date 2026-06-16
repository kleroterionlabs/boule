// src/github/mutations.ts — write-side GraphQL documents (no client logic).

export const CREATE_ISSUE = /* GraphQL */ `
mutation CreateIssue($repositoryId: ID!, $title: String!, $body: String!, $labelIds: [ID!], $issueTypeId: ID) {
  createIssue(input: { repositoryId: $repositoryId, title: $title, body: $body, labelIds: $labelIds, issueTypeId: $issueTypeId }) {
    issue { number nodeId: id url }
  }
}`;

export const UPDATE_ISSUE_BODY = /* GraphQL */ `
mutation UpdateBody($id: ID!, $body: String!) {
  updateIssue(input: { id: $id, body: $body }) { issue { number } }
}`;

export const SET_ISSUE_TYPE = /* GraphQL */ `
mutation SetType($id: ID!, $typeId: ID!) {
  updateIssue(input: { id: $id, issueTypeId: $typeId }) { issue { issueType { name } } }
}`;

export const ADD_SUB_ISSUE = /* GraphQL */ `
mutation AddSubIssue($issueId: ID!, $subIssueId: ID!) {
  addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId }) { subIssue { number } }
}`;

export const ADD_COMMENT = /* GraphQL */ `
mutation AddComment($subjectId: ID!, $body: String!) {
  addComment(input: { subjectId: $subjectId, body: $body }) { commentEdge { node { id } } }
}`;

export const ADD_PROJECT_ITEM = /* GraphQL */ `
mutation AddItem($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } }
}`;

export const SET_FIELD_VALUE = /* GraphQL */ `
mutation SetField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
  updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }) {
    projectV2Item { id }
  }
}`;

export const CREATE_DISCUSSION = /* GraphQL */ `
mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
  createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
    discussion { number nodeId: id url }
  }
}`;

export const ADD_DISCUSSION_COMMENT = /* GraphQL */ `
mutation AddDiscussionComment($discussionId: ID!, $body: String!, $replyTo: ID) {
  addDiscussionComment(input: { discussionId: $discussionId, body: $body, replyToId: $replyTo }) { comment { id url } }
}`;

// Single-select options REQUIRE name + color (enum) + description — omitting either is a schema error.
export const CREATE_SELECT_FIELD = /* GraphQL */ `
mutation CreateSelectField($projectId: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
  createProjectV2Field(input: { projectId: $projectId, dataType: SINGLE_SELECT, name: $name, singleSelectOptions: $options }) {
    projectV2Field { ... on ProjectV2SingleSelectField { id name } }
  }
}`;

export const CREATE_NUMBER_FIELD = /* GraphQL */ `
mutation CreateNumberField($projectId: ID!, $name: String!) {
  createProjectV2Field(input: { projectId: $projectId, dataType: NUMBER, name: $name }) {
    projectV2Field { ... on ProjectV2Field { id name } }
  }
}`;
