# flame

flame is cuped's SDK for websites. It picks each visitor's arm in the browser and reports what the visitor saw and did.

## Language

**Arm**:
The variant of an experiment that one visitor gets.
_Avoid_: Assignment (on its own), bucket

**Saved arm**:
An arm that flame recorded for this visitor on an earlier visit and kept in the browser.
_Avoid_: Stored assignment, cached arm, sticky arm

**Rules file**:
One document per project, the same for every visitor, that flame picks new visitors' arms from.
_Avoid_: Config, experiment list

**Exposure**:
The record that a visitor saw a real arm of a running experiment. A read of the arm makes it.
_Avoid_: Impression, assignment record (outside ember)

**Early answer**:
The arm that flame-react can show before flame is ready, from the saved arm and the stored rules file alone. It records no exposure.
_Avoid_: Peek, optimistic arm, cached answer
