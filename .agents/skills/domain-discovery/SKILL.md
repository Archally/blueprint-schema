---
name: domain-discovery
description: Domain discovery and knowledge elicitation methods. Use when kickstarting domain exploration, discovering bounded contexts, capturing as-is processes, decomposing features into specs, or when EventStorming, Domain Storytelling, Example Mapping, Impact Mapping, User Story Mapping, or Storystorming are relevant.
---

# Domain Discovery & Knowledge Elicitation

Answer: *What is actually happening in this domain? What do people really do?*

Use this skill when the blueprint modeler needs to discover, elicit, or validate domain knowledge before or during modeling - especially at kickoff, legacy modernization, or when stories are ambiguous.

---

## Methods

### EventStorming (Alberto Brandolini)
Collaborative workshop with colored sticky notes mapping domain events across a timeline. Three flavors: Big Picture, Process Modeling, Software Design. Hotspots (confusion, disagreement) are often more valuable than the events.

**When:** Kickoff of complex domain projects, legacy modernization, discovering bounded context boundaries.

**Best sources:**
- https://www.eventstorming.com/ - Official site, book, resources
- https://www.eventstorming.com/resources/ - Starter kit, articles
- Alberto Brandolini, "Introducing Event Storming" (DDD Europe 2019 video)

### Domain Storytelling (Stefan Hofer, Henning Schwentner)
Pictographic technique: domain experts narrate using actors, work objects, activities. Lower barrier than EventStorming. Captures *who does what with what in what order*.

**When:** Capture as-is processes before redesign; when EventStorming feels too chaotic.

**Best sources:**
- https://domainstorytelling.org/ - Quick Start, articles
- https://domainstorytelling.org/articles/domain-message-flow-modeling/ - Domain Message Flow Modeling
- https://egon.io/ - Free browser tool for Domain Stories

### Example Mapping (Matt Wynne / Cucumber)
Four colors: yellow (story), blue (rules), green (examples), red (questions). ~25 min. Fast decomposition to testable specs. Bridges to BDD/Gherkin.

**When:** Three-amigos sessions before sprint; stories ambiguous or too large. Signal: many red = not ready, many blue = slice story.

**Best sources:**
- https://cucumber.io/docs/bdd/example-mapping/ - Official docs
- https://cucumber.io/blog/bdd/example-mapping-introduction - Matt Wynne intro
- https://medium.com/@mattwynne/introducing-example-mapping-42ccd15f8adf - Original article

### Impact Mapping (Gojko Adzic)
Strategic planning: Goal → Actors → Impacts → Deliverables (mind map). Forces "why are we building this?" before "what are we building?"

**When:** Product roadmap, feature prioritization, disconnect between business goals and backlog.

**Best sources:**
- https://www.impactmapping.org/ - Official site
- Gojko Adzic, "Impact Mapping" (book)

### User Story Mapping (Jeff Patton)
2D: activities horizontal (time/workflow), story cards vertical (priority). Creates product backbone; walking it reveals gaps. Release planning by slicing.

**When:** Backlogs are flat/unstructured; teams lose big picture.

**Best sources:**
- Jeff Patton, "User Story Mapping" (O'Reilly)
- https://jpattonassociates.com/ - Jeff Patton's site

### Storystorming (Martin Schimak)
Meta-method mapping EventStorming, Domain Storytelling, User Story Mapping, Impact Mapping onto shared colored sticky-note building blocks.

**When:** Team uses multiple discovery methods and needs seamless transitions.

**Best sources:**
- Martin Schimak - DDD Europe talks, community articles

---

## Blueprint Integration

Discovery outputs feed blueprint artifacts:
- **concepts.yaml** - Ubiquitous terms from events, stories, examples
- **rules.yaml** - Rules surfaced in Example Mapping, Domain Storytelling
- **story.yaml** - Domain stories with operation sequences
- **arch.yaml** - Bounded contexts from EventStorming hotspots, Domain Storytelling
