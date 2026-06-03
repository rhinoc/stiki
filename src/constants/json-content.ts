import type { JSONContent } from "@tiptap/core";

export const JSON_LANDING_PAGE: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: {
        level: 1,
      },
      content: [
        {
          type: "text",
          text: "Welcome to Stiki 🏄🏻‍♂️",
        },
      ],
    },
    {
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Here is a demonstration of what ",
            },
            {
              type: "text",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: "https://github.com/rhinoc/stiki",
                    target: "_custom",
                    title: null,
                  },
                },
              ],
              text: "Stiki",
            },
            {
              type: "text",
              text: " can do. ",
            },
          ],
        },
      ],
    },
    {
      type: "heading",
      attrs: {
        level: 2,
      },
      content: [
        {
          type: "text",
          text: "Emphasis",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          marks: [
            {
              type: "bold",
            },
          ],
          text: "bold ",
        },
        {
          type: "text",
          marks: [
            {
              type: "italic",
            },
          ],
          text: "italic ",
        },
        {
          type: "text",
          marks: [
            {
              type: "strike",
            },
          ],
          text: "strikethrough",
        },
      ],
    },
    {
      type: "heading",
      attrs: {
        level: 2,
      },
      content: [
        {
          type: "text",
          text: "Code",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          marks: [
            {
              type: "code",
            },
          ],
          text: "foo",
        },
        {
          type: "text",
          text: " and ",
        },
        {
          type: "text",
          marks: [
            {
              type: "code",
            },
          ],
          text: "bar",
        },
      ],
    },
    {
      type: "codeBlock",
      attrs: {
        language: null,
      },
      content: [
        {
          type: "text",
          text: 'console.info(foo("bar"));',
        },
      ],
    },
    {
      type: "heading",
      attrs: {
        level: 2,
      },
      content: [
        {
          type: "text",
          text: "List",
        },
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: {
            checked: true,
          },
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Completed task",
                },
              ],
            },
          ],
        },
        {
          type: "taskItem",
          attrs: {
            checked: false,
          },
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Todo task",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "orderedList",
      attrs: {
        tight: true,
        start: 1,
      },
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "First item",
                },
              ],
            },
            {
              type: "bulletList",
              attrs: {
                tight: true,
              },
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "Unordered item",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Second item",
                },
              ],
            },
            {
              type: "orderedList",
              attrs: {
                tight: true,
                start: 1,
              },
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "Sub-item",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "heading",
      attrs: {
        level: 2,
      },
      content: [
        {
          type: "text",
          text: "Link",
        },
      ],
    },
    {
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Tips: You can use ⌘+click to open a link.",
            },
          ],
        },
      ],
    },
    {
      type: "bulletList",
      attrs: {
        tight: true,
      },
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  marks: [
                    {
                      type: "link",
                      attrs: {
                        href: "https://github.com/rhinoc/stiki",
                        target: "_custom",
                        title: null,
                      },
                    },
                  ],
                  text: "https://github.com/rhinoc/stiki",
                },
              ],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  marks: [
                    {
                      type: "link",
                      attrs: {
                        href: "https://github.com/rhinoc/stiki",
                        target: "_custom",
                        title: null,
                      },
                    },
                  ],
                  text: "Stiki",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

export const JSON_EMPTY: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };
