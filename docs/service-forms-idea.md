# Service Forms: Draft Idea (For Later)

Status: idea only, nothing built yet.

## The Idea

Every service (Tank Cleaning, Tank Replacement, Water Cleaning, Water Testing, or any new one) gets its
own form. Admins build the form themselves, like Google Forms. Nothing is fixed in the code, so a new
service never needs a developer.

## Building a Form

- Open a service, click **Add Field**, choose the type, type the question
- Field types:
  - Text
  - Number
  - Date / Time
  - Dropdown / Choice
  - Yes / No
  - Photo / File (needs R2)
- Mark a field as **Required**
- Drag fields to change their order

## Linked Options (Show-If)

- A field appears only when another answer matches
- Example: if *Result = Positive*, show *Action Taken*
- Keep it to simple one-step rules

## Duplicate

- **Duplicate a form**: build Tank Cleaning once, duplicate it, rename it to Tank Replacement, then
  add or remove fields. The copy is separate; editing one does not change the other.
- **Duplicate a field**: copy a field (for example a dropdown with many choices) inside the same form

## Excel Headings Import (Quick Start)

- Upload an Excel file with only the headings
- Each heading becomes a field (Text by default)
- The admin then changes the field types where needed

## Repeating Section (Optional)

- For one job with several items, for example 3 tanks in one Tank Replacement job
- The engineer clicks **+ Add Another** to fill the same fields again

## Optional Later

- Preview the form before engineers see it
- Client, site, engineer and date filled in automatically from the project
- Archive a form instead of deleting it, so old records stay readable

## Build Order

1. Form builder with the basic field types, plus Duplicate
2. Show-if rules and Excel headings import
3. Photo / File fields once R2 is switched on
