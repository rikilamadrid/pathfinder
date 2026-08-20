---
name: quiz-me
description: Assess understanding of a recently taught feature using varied, evidence-based questions and targeted feedback.
argument-hint: optional lesson path or feature name
---

# Quiz Me

Use this skill after `teach-feature`, or when the user wants to test understanding of a feature or concept.

The goal is retrieval and diagnosis, not entertainment and not a long exam.

## Read First

1. `context/learning/learner-profile.md`
2. The relevant lesson in `context/learning/lessons/`
3. `context/current-feature.md`
4. Only the implementation or tests needed to verify answers
5. `context/learning/progress.md`

Skip any of these that does not exist. Pathfinder creates these files only when a workflow first needs them, so their absence is normal and is not an error. Do not create them just to satisfy this list.

## Quiz Shape

Create 5 questions by default. Mix at least three formats:

- Predict what happens
- Explain why a decision was made
- Trace data or event flow
- Find or diagnose a bug
- Choose between architectural alternatives
- Identify an accessibility or performance risk
- Interpret a focused code excerpt
- Explain how a test proves behavior

Avoid:

- pure trivia
- questions answerable only by memorizing file names
- five multiple-choice questions
- ambiguous questions without a defensible answer
- testing concepts not present in the lesson or code

## Delivery

Ask one question at a time.

After each answer:

1. Mark it as correct, partially correct, or incorrect.
2. Explain the key point concisely.
3. Ask one targeted follow-up only when it will diagnose a meaningful gap.
4. Continue to the next question.

Do not reveal all answers before the learner responds.

## Scoring

At the end, report:

- Strong understanding
- Partial understanding
- Gaps to reinforce
- One recommended next action

Do not use a percentage unless every question had a clear scoring basis.

## Progress Update

Update `context/learning/progress.md` with demonstrated evidence.

Use the confidence scale already defined there.

A correct answer with heavy hints is `practiced`, not `independent`.

## Scope

- Do not change product code.
- Do not inflate the quiz to cover the whole stack.
- Do not treat one quiz as proof of mastery.
