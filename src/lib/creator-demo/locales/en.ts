/**
 * The `/creator` demo in English (British spelling), translated from the
 * Slovenian source in `./sl.ts`. See `../content-types.ts` for what each field
 * is and the rules a translation has to keep.
 */
import type { DemoLocaleContent, DemoNotePack } from "@/lib/creator-demo/content-types";

const MIKROEKONOMIJA: DemoNotePack = {
  key: "mikroekonomija",
  title: "Microeconomics – supply and demand",
  sourceType: "audio",
  durationSeconds: 2842,
  summary:
    "The lecture explains how the supply and demand curves set the market equilibrium, what shifts a whole curve, and how elasticity tells you how strongly quantity responds to a change in price.",
  keyTopics: [
    "The law of demand",
    "The law of supply",
    "Market equilibrium",
    "Shift of the curve versus movement along it",
    "Price elasticity",
  ],
  notesMd: `## Quick Overview

A market works like a negotiation between buyers and sellers: buyers want a low price, sellers want a high one, and the price settles where the quantity people want to buy matches the quantity others want to sell. This point is the market equilibrium. When any factor other than price changes, the whole curve shifts and a new equilibrium forms.

> **Key takeaway:** Price does not shift the curve – it only moves the point along it. The curve is shifted by income, the prices of other goods, expectations, technology and the number of buyers and sellers in the market.

## Key Things To Know

- The law of demand: other things being equal, buyers purchase less at a higher price.
- The law of supply: at a higher price, producers offer more, because production is more profitable.
- Equilibrium is the only price with neither a surplus nor a shortage.
- Above the equilibrium price there is a surplus; below it, a shortage.
- Only a change in price causes a movement along the curve; everything else shifts the curve itself.
- Elasticity measures how sensitive quantity is to a change in price, and it decides whether a price rise increases or reduces revenue.

| Event | Which curve | Direction of shift | Effect on the equilibrium price |
| --- | --- | --- | --- |
| Buyers' incomes rise | Demand | To the right | Rises |
| Cheaper raw materials | Supply | To the right | Falls |
| A new competitor enters | Supply | To the right | Falls |
| A future price rise is expected | Demand | To the right | Rises |

## 1. 📉 Demand

### Core Idea

Demand shows how many units of a good buyers are willing and able to buy at each price over a given period.

### Detailed Notes

The demand curve slopes downwards because each additional unit brings the buyer less extra benefit, while a higher price also reduces their real purchasing power. Note that we are talking about the quantity buyers plan to purchase, not the quantity they actually end up buying.

- **Definition:** Quantity demanded is the amount at a single price, whereas demand is the whole relationship between price and quantity.
- Market demand is built up from the individual demands of every buyer in the market.
- Necessities have a steeper demand curve than luxury goods.

### Key Terms

- **Substitutes:** goods that can replace each other (tea and coffee).
- **Complements:** goods that are used together (a printer and ink cartridges).
- **Inferior good:** demand for it falls when income rises.

## 2. 📈 Supply

### Core Idea

Supply shows how many units producers are willing to sell at each price.

### Detailed Notes

The supply curve slopes upwards because a higher price covers higher marginal costs of production and draws new suppliers into the industry. That is also why supply responds more slowly than demand in the short run – capacity cannot be expanded overnight.

- Labour and raw-material costs shift the supply curve upwards, in other words to the left.
- Better technology lowers unit costs and shifts supply to the right.
- A tax on a product acts as an extra cost and reduces supply.

## 3. ⚖️ Market Equilibrium

### Core Idea

Equilibrium is the price at which quantity demanded equals quantity supplied.

### Detailed Notes

If the price is too high, goods go unsold and sellers cut the price. If the price is too low, queues form and sellers raise it. The market therefore pushes itself towards equilibrium, even though the adjustment is not always quick.

> **Common mistake:** A surplus does not mean the buyers have vanished – most of the time it simply means the price is above equilibrium.

### Example

If a concert ticket costs €60 but the equilibrium price is €45, part of the hall stays empty. The organiser cuts the price, and the number of tickets sold rises along the same demand curve.

## 4. 🔁 Elasticity

### Core Idea

Price elasticity of demand tells you by what percentage quantity changes when the price changes by one per cent.

### Detailed Notes

Elasticity is calculated as the ratio of the percentage change in quantity to the percentage change in price. When the absolute value of the result is greater than 1, demand is elastic and a price rise lowers total revenue.

- **Elastic demand:** many substitutes, a long time horizon, luxury goods.
- **Inelastic demand:** few substitutes, a short time frame, necessities.
- **Key takeaway:** revenue is at its highest where elasticity equals 1.

### Check Yourself

- What happens to the equilibrium price if supply and demand both increase at the same time?
- Why doesn't a change in price shift the demand curve?
- When does a price rise increase a firm's total revenue?
- Which factors make demand more elastic?

## Final Review

- Demand slopes down, supply slopes up, and the point where they cross is equilibrium.
- A change in price is a movement along the curve; anything else shifts the whole curve.
- A surplus pushes the price down, a shortage pushes it up.
- Elasticity decides how a price rise affects revenue.
- The most common exam mistake is confusing a shift of the curve with a movement along the curve.`,
  images: [
    {
      file: "en/ponudba-povprasevanje.svg",
      fileName: "equilibrium-graph.png",
      alt: "Supply and demand graph with the equilibrium point",
      afterText: "If the price is too high, goods go unsold",
    },
    {
      file: "en/elasticnost.svg",
      fileName: "elasticity-comparison.png",
      alt: "Elastic and inelastic demand compared",
      afterText: "Elasticity is calculated as the ratio",
    },
  ],
  sections: [
    { title: "Demand", sourceLabel: "00:00 – 11:20" },
    { title: "Supply", sourceLabel: "11:20 – 24:05" },
    { title: "Market equilibrium", sourceLabel: "24:05 – 36:40" },
    { title: "Elasticity", sourceLabel: "36:40 – 47:22" },
  ],
  flashcards: [
    {
      front: "What does the law of demand say?",
      back: "Other things being equal, buyers purchase a smaller quantity of a good when its price is higher.",
      hint: "Price up, quantity down.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "What is the difference between demand and quantity demanded?",
      back: "Quantity demanded is a single point at a single price, whereas demand is the whole relationship between price and quantity – the entire curve.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "What are substitutes?",
      back: "Goods that can replace each other. When one gets dearer, demand for the other rises – tea and coffee, for example.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Why does the supply curve slope upwards?",
      back: "A higher price covers higher marginal costs and draws extra suppliers into the industry, so it makes sense to produce more.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "How does a tax on a product affect supply?",
      back: "It acts as an extra cost per unit, so it shifts the supply curve to the left, or upwards.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "What is market equilibrium?",
      back: "The price at which quantity demanded equals quantity supplied, so there is neither a surplus nor a shortage.",
      difficulty: "easy",
      sectionIdx: 2,
    },
    {
      front: "What happens when the price is above equilibrium?",
      back: "A surplus: unsold goods push the price down towards equilibrium.",
      difficulty: "medium",
      sectionIdx: 2,
    },
    {
      front: "When does the whole demand curve shift?",
      back: "When income, the prices of substitutes or complements, tastes, expectations or the number of buyers change – never when the good's own price changes.",
      hint: "Everything except price.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "How do you calculate the price elasticity of demand?",
      back: "Divide the percentage change in quantity by the percentage change in price. An absolute value above 1 means demand is elastic.",
      difficulty: "hard",
      sectionIdx: 3,
    },
    {
      front: "When does a price rise increase total revenue?",
      back: "When demand is inelastic, that is, when quantity changes proportionally less than the price.",
      difficulty: "hard",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "The price of coffee rises. What happens in the market for tea?",
      options: [
        "Demand for tea increases",
        "Demand for tea decreases",
        "The supply of tea decreases",
        "Nothing changes in the tea market",
      ],
      correctOptionIdx: 0,
      explanation:
        "Tea is a substitute for coffee, so some buyers switch to tea and the demand curve for tea shifts to the right.",
      difficulty: "easy",
    },
    {
      prompt: "Which event shifts the supply curve to the right?",
      options: [
        "A rise in the price of raw materials",
        "A new tax on the product",
        "Cheaper production technology",
        "A rise in the price of the finished product",
      ],
      correctOptionIdx: 2,
      explanation:
        "Better technology lowers unit costs, so producers are willing to offer more at every price.",
      difficulty: "medium",
    },
    {
      prompt: "The price is below equilibrium. What happens?",
      options: [
        "A surplus appears",
        "A shortage appears and the price rises",
        "The market is in equilibrium",
        "The demand curve shifts to the left",
      ],
      correctOptionIdx: 1,
      explanation:
        "When the price is too low, buyers want more than is available. The shortage pushes the price up towards equilibrium.",
      difficulty: "easy",
    },
    {
      prompt: "A change in a good's own price causes:",
      options: [
        "A movement along the demand curve",
        "A shift of the whole demand curve",
        "A shift of the whole supply curve",
        "A change in elasticity",
      ],
      correctOptionIdx: 0,
      explanation:
        "Price is on the axis of the graph, so a change in it means moving along the existing curve, not shifting it.",
      difficulty: "medium",
    },
    {
      prompt: "Demand is elastic when the elasticity coefficient is:",
      options: [
        "Less than 1 in absolute value",
        "Equal to 1 in absolute value",
        "Greater than 1 in absolute value",
        "Always negative",
      ],
      correctOptionIdx: 2,
      explanation:
        "An absolute value above 1 means that quantity changes proportionally more than the price.",
      difficulty: "medium",
    },
    {
      prompt: "A firm sells a necessity with no substitutes and raises its price. Its revenue will most likely:",
      options: [
        "Fall, because buyers will leave",
        "Rise, because demand is inelastic",
        "Stay the same",
        "Depend on supply alone",
      ],
      correctOptionIdx: 1,
      explanation:
        "With no substitutes, demand is inelastic, so quantity falls proportionally less than the price rises.",
      difficulty: "hard",
    },
    {
      prompt: "Buyers' incomes rise and the good is an inferior one. Demand:",
      options: ["Increases", "Decreases", "Does not change", "Turns into supply"],
      correctOptionIdx: 1,
      explanation:
        "With inferior goods, buyers switch to better-quality alternatives when their income rises.",
      difficulty: "hard",
    },
    {
      prompt: "Supply and demand both increase at the same time. What is certain?",
      options: [
        "The price is certain to rise",
        "The price is certain to fall",
        "The equilibrium quantity increases",
        "The equilibrium quantity decreases",
      ],
      correctOptionIdx: 2,
      explanation:
        "Both shifts increase the quantity, but the effect on the price depends on which shift is stronger.",
      difficulty: "hard",
    },
  ],
  practice: [
    {
      prompt:
        "Explain the difference between a movement along the demand curve and a shift of the whole curve. Give one example of each.",
      answerGuide:
        "A movement along the curve is caused only by a change in the good's own price. A shift of the whole curve is caused by non-price factors: income, the prices of substitutes and complements, tastes, expectations and the number of buyers.",
      difficulty: "medium",
      expectedAnswer:
        "A change in price = a movement along the curve (e.g. the price of coffee falls and buyers buy more coffee). A change in a non-price factor = a shift of the curve (e.g. income rises and the whole curve shifts to the right).",
      strengths: "You clearly separate price and non-price factors.",
      missingPoints: "Add a concrete example of a shift to the left, such as a fall in income.",
    },
    {
      prompt:
        "A surplus appears in a market. Describe the mechanism that brings the market back to equilibrium.",
      answerGuide:
        "A surplus means the price is above equilibrium. Unsold stock forces sellers to cut the price, which raises the quantity demanded and lowers the quantity supplied until the two are equal.",
      difficulty: "easy",
      expectedAnswer:
        "The price is too high, stock builds up, sellers cut prices, quantity demanded rises and quantity supplied falls until the surplus is gone.",
      strengths: "You correctly identify which way the price is pushed.",
      missingPoints: "Mention that we move along both curves rather than shifting them.",
    },
    {
      prompt:
        "A firm is considering a 10 per cent price rise. What does it need to know about elasticity before deciding?",
      answerGuide:
        "If demand is elastic, revenue will fall, because quantity will drop by more than 10 per cent. If it is inelastic, revenue will rise. The key factors are the availability of substitutes, the share of the buyer's budget and the time period.",
      difficulty: "hard",
      expectedAnswer:
        "It needs to calculate the price elasticity. Above 1 means lost revenue, below 1 means higher revenue. It also has to consider substitutes and how buyers respond in the long run.",
      strengths: "You link elasticity to revenue.",
      missingPoints: "Add that long-run elasticity is usually greater than short-run elasticity.",
    },
    {
      prompt:
        "The government introduces a tax on a product. Explain the effect on the supply curve, the equilibrium price and the equilibrium quantity.",
      answerGuide:
        "The tax raises unit costs and shifts supply to the left. The equilibrium price paid by buyers rises and the equilibrium quantity falls. The tax burden is shared between buyers and sellers according to elasticity.",
      difficulty: "medium",
      expectedAnswer:
        "Supply shifts to the left, the price rises, the quantity falls, and the side of the market that is more inelastic bears more of the tax.",
      strengths: "You identify which way supply shifts.",
      missingPoints: "Explain how the tax burden is split according to elasticity.",
    },
    {
      prompt: "Why does supply respond more slowly than demand in the short run?",
      answerGuide:
        "Production capacity, contracts and raw materials are fixed in the short run, so producers cannot scale up output quickly. Buyers, on the other hand, can change their decisions straight away.",
      difficulty: "medium",
      expectedAnswer:
        "Because capacity and inputs are limited in the short run, while buyers can change what they buy immediately.",
      strengths: "You recognise the time dimension of adjustment.",
      missingPoints: "Give a concrete example, such as building a new production line.",
    },
  ],
  transcript: [
    {
      startMs: 0,
      endMs: 28000,
      speakerLabel: "Lecturer",
      text: "Good morning. Today we're finishing the chapter on markets – supply, demand and equilibrium. This is material you'll need for practically every question in the exam.",
    },
    {
      startMs: 28000,
      endMs: 74000,
      speakerLabel: "Lecturer",
      text: "Let's start with demand. Demand isn't a single number; it's a relationship between price and quantity. As the price rises, the quantity demanded falls. That's the law of demand.",
    },
    {
      startMs: 74000,
      endMs: 132000,
      speakerLabel: "Lecturer",
      text: "Watch out for the distinction students miss most often. Quantity demanded is one point on the curve; demand is the whole curve. If the price changes, we move along the curve.",
    },
    {
      startMs: 132000,
      endMs: 205000,
      speakerLabel: "Lecturer",
      text: "The curve is shifted by other factors: income, the prices of substitutes and complements, tastes, expectations and the number of buyers in the market. If income rises, the curve shifts to the right.",
    },
    {
      startMs: 205000,
      endMs: 268000,
      speakerLabel: "Student",
      text: "What about inferior goods? It's the other way round there, isn't it?",
    },
    {
      startMs: 268000,
      endMs: 330000,
      speakerLabel: "Lecturer",
      text: "Exactly. With inferior goods, higher income lowers demand, because buyers switch to a better-quality alternative.",
    },
    {
      startMs: 680000,
      endMs: 742000,
      speakerLabel: "Lecturer",
      text: "Let's move on to supply. The supply curve slopes upwards because a higher price covers higher marginal costs and attracts new producers into the industry.",
    },
    {
      startMs: 742000,
      endMs: 815000,
      speakerLabel: "Lecturer",
      text: "Supply is shifted by raw-material costs, technology, taxes and subsidies. New technology lowers unit costs and shifts supply to the right.",
    },
    {
      startMs: 1445000,
      endMs: 1512000,
      speakerLabel: "Lecturer",
      text: "Equilibrium is where the two curves cross. It's the only price at which there's no surplus and no shortage.",
    },
    {
      startMs: 1512000,
      endMs: 1588000,
      speakerLabel: "Lecturer",
      text: "If the price is too high, goods go unsold, a surplus builds up and sellers cut the price. If it's too low, there's a shortage and the price goes up.",
    },
    {
      startMs: 2200000,
      endMs: 2276000,
      speakerLabel: "Lecturer",
      text: "The last topic is elasticity. Elasticity is the percentage change in quantity divided by the percentage change in price.",
    },
    {
      startMs: 2276000,
      endMs: 2360000,
      speakerLabel: "Lecturer",
      text: "If the absolute value is greater than one, demand is elastic and a price rise lowers revenue. If it's less than one, a price rise increases revenue.",
    },
    {
      startMs: 2360000,
      endMs: 2430000,
      speakerLabel: "Student",
      text: "Does that mean it always pays to raise the price of necessities?",
    },
    {
      startMs: 2430000,
      endMs: 2520000,
      speakerLabel: "Lecturer",
      text: "In the short run it often does, but in the long run buyers find alternatives, which is why long-run elasticity is almost always greater than short-run elasticity.",
    },
    {
      startMs: 2760000,
      endMs: 2842000,
      speakerLabel: "Lecturer",
      text: "For next time, go through examples one to five. There'll definitely be a curve-shift question in the exam, so practise drawing the graphs.",
    },
  ],
  chatAnswers: [
    "In short: the demand curve slopes downwards because each additional unit brings the buyer less benefit, and a higher price also reduces their real purchasing power. So at a higher price, buyers plan to buy a smaller quantity.",
    "The difference is in what moves. If the price of the good itself changes, you move along the existing curve. If anything else changes – income, the price of a substitute, expectations – the whole curve shifts.",
    "Yes, that's a classic exam question. If demand is inelastic (a coefficient below 1), a price rise increases total revenue, because quantity falls proportionally less than the price rises. With elastic demand, the effect is the opposite.",
    "A surplus means the price is above equilibrium. Stock builds up, sellers cut the price, and as they do, the quantity demanded rises and the quantity supplied falls until the market is back in equilibrium.",
  ],
};

const ANATOMIJA: DemoNotePack = {
  key: "anatomija",
  title: "Anatomy – structure of the nervous system",
  sourceType: "pdf",
  durationSeconds: null,
  pageCount: 24,
  summary:
    "The handout divides the nervous system into its central and peripheral parts, describes the neuron as its basic unit, and explains how the action potential and the synapse carry information around the body.",
  keyTopics: [
    "Central and peripheral nervous system",
    "Structure of the neuron",
    "The action potential",
    "Synaptic transmission",
    "The autonomic nervous system",
  ],
  notesMd: `## Quick Overview

The nervous system is the body's information system: it receives stimuli, processes them and triggers a response. Anatomically, it is divided into the central nervous system, which processes information, and the peripheral nervous system, which carries it between the body and the brain. Its basic functional unit is the neuron, which transmits information electrochemically.

> **Key takeaway:** The electrical signal travels within a neuron, but between neurons the transmission is always converted into a chemical signal across a synapse.

## Key Things To Know

- The central nervous system consists of the brain and the spinal cord.
- The peripheral nervous system is made up of the nerves and ganglia outside the central nervous system.
- A neuron has dendrites, a cell body, an axon and axon terminals.
- The myelin sheath speeds up conduction through saltatory conduction between the nodes of Ranvier.
- The action potential is an all-or-nothing response.
- The autonomic nervous system is divided into a sympathetic and a parasympathetic branch with opposing effects.

| Division | Main function | Typical structure |
| --- | --- | --- |
| Central | Processing and storing information | Cerebral cortex, spinal cord |
| Somatic | Voluntary movement and sensation | Motor and sensory fibres |
| Sympathetic | Activation, fight or flight | Noradrenaline predominates |
| Parasympathetic | Calming, digestion and recovery | Acetylcholine predominates |

## 1. 🧠 Divisions of the Nervous System

### Core Idea

Functionally, the nervous system is divided into a central part that processes information and a peripheral part that carries it.

### Detailed Notes

The brain and the spinal cord form the central nervous system, protected by bone, the meninges and cerebrospinal fluid. The peripheral nervous system consists of the nerves that connect the central part with the organs, muscles and skin.

- The somatic division controls voluntary movements of the skeletal muscles.
- The autonomic division regulates the organs without conscious control.
- The spinal cord is not just a cable: it can carry out a reflex arc on its own, without involving the brain.

### Key Terms

- **Ganglion:** a cluster of nerve cell bodies outside the central nervous system.
- **Nucleus:** a cluster of nerve cell bodies inside the central nervous system.
- **Reflex arc:** the shortest pathway from a receptor to an effector.

## 2. 🔬 The Neuron

### Core Idea

A neuron is a cell specialised for receiving, conducting and passing on an electrical signal.

### Detailed Notes

Dendrites receive signals, the cell body sums them, and the axon conducts the action potential to the axon terminals. The myelin sheath acts as an insulator, so the signal jumps between the nodes of Ranvier and travels much faster.

- **Definition:** The axon hillock is where it is decided whether an action potential will fire.
- Glial cells nourish and support neurons and form myelin.
- A thicker, more heavily myelinated axon conducts faster.

## 3. ⚡ The Action Potential

### Core Idea

An action potential is a rapid reversal of the membrane voltage that spreads along the axon without weakening.

### Detailed Notes

At rest, the inside of the cell is negative. When a stimulus reaches threshold, sodium channels open, sodium rushes into the cell and depolarisation occurs. Potassium then leaves the cell, which is repolarisation, followed by a brief refractory period.

> **Common mistake:** A stronger stimulus does not produce a bigger action potential – it only increases the firing frequency.

### Process

- The stimulus reaches the threshold of excitation.
- Sodium channels open and depolarisation follows.
- Potassium channels open and repolarisation follows.
- The sodium–potassium pump restores the resting potential.

## 4. 🔗 The Synapse

### Core Idea

A synapse is the junction between two neurons, where the electrical signal is converted into a chemical one.

### Detailed Notes

When the action potential reaches the axon terminal, calcium channels open. Vesicles containing neurotransmitter fuse with the membrane and release it into the synaptic cleft, where it binds to receptors on the next cell.

- Excitatory neurotransmitters increase the likelihood of a new action potential.
- Inhibitory neurotransmitters reduce that likelihood.
- Once it has acted, the neurotransmitter is broken down or taken back up into the presynaptic cell.

### Check Yourself

- Which structures make up the central nervous system?
- Why does myelin speed up conduction?
- What does the all-or-nothing principle mean?
- How is a signal passed from one neuron to the next?

## Final Review

- The central nervous system processes information; the peripheral nervous system carries it.
- A neuron consists of dendrites, a cell body, an axon and axon terminals.
- The action potential follows the all-or-nothing principle; stimulus strength is coded by frequency.
- Myelin makes conduction saltatory and faster.
- A synapse converts an electrical signal into a chemical one and back again.`,
  images: [
    {
      file: "en/nevron.svg",
      fileName: "neuron-diagram.png",
      alt: "Structure of a neuron with dendrites, cell body, axon and axon terminals",
      afterText: "Dendrites receive signals, the cell body sums them",
    },
    {
      file: "en/akcijski-potencial.svg",
      fileName: "action-potential.png",
      alt: "The course of an action potential over time",
      afterText: "At rest, the inside of the cell is negative",
    },
  ],
  sections: [
    { title: "Divisions of the nervous system", sourceLabel: "pp. 3–7" },
    { title: "Structure of the neuron", sourceLabel: "pp. 8–12" },
    { title: "The action potential", sourceLabel: "pp. 13–18" },
    { title: "Synaptic transmission", sourceLabel: "pp. 19–24" },
  ],
  flashcards: [
    {
      front: "What makes up the central nervous system?",
      back: "The brain and the spinal cord, protected by bone, the meninges and cerebrospinal fluid.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "What is the difference between a ganglion and a nucleus?",
      back: "A ganglion is a cluster of nerve cell bodies outside the central nervous system; a nucleus is one inside it.",
      difficulty: "hard",
      sectionIdx: 0,
    },
    {
      front: "What is a reflex arc?",
      back: "The shortest nerve pathway from a receptor through the spinal cord to an effector, without involving the brain.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "List the main parts of a neuron.",
      back: "Dendrites, the cell body, the axon and the axon terminals.",
      hint: "From receiving the signal to passing it on.",
      difficulty: "easy",
      sectionIdx: 1,
    },
    {
      front: "Why does the myelin sheath speed up conduction?",
      back: "It acts as an insulator, so the signal jumps between the nodes of Ranvier – this is saltatory conduction.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "What happens at the axon hillock?",
      back: "Incoming signals are summed there, and it is decided whether threshold is exceeded and an action potential fires.",
      difficulty: "hard",
      sectionIdx: 1,
    },
    {
      front: "What does the all-or-nothing principle mean?",
      back: "An action potential either fires at full size or not at all. Stimulus strength is coded by the firing frequency.",
      difficulty: "medium",
      sectionIdx: 2,
    },
    {
      front: "Which ion causes depolarisation?",
      back: "Sodium, which rushes into the cell when voltage-gated channels open.",
      difficulty: "easy",
      sectionIdx: 2,
    },
    {
      front: "What is the refractory period?",
      back: "A brief period after an action potential when the neuron cannot be excited, which ensures the signal travels in one direction only.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "How is a signal transmitted across a synapse?",
      back: "The action potential triggers an influx of calcium, vesicles release neurotransmitter into the cleft, and it binds to receptors on the next cell.",
      difficulty: "medium",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "Which pair forms the central nervous system?",
      options: [
        "The brain and the spinal cord",
        "The brain and the peripheral nerves",
        "The spinal cord and the ganglia",
        "Nerves and receptors",
      ],
      correctOptionIdx: 0,
      explanation: "By definition, the central nervous system consists of the brain and the spinal cord.",
      difficulty: "easy",
    },
    {
      prompt: "What makes saltatory conduction possible?",
      options: [
        "The thickness of the dendrites",
        "The myelin sheath with its nodes of Ranvier",
        "The number of synapses",
        "The size of the cell body",
      ],
      correctOptionIdx: 1,
      explanation:
        "Myelin insulates the axon, so depolarisation happens only at the nodes and the signal jumps between them.",
      difficulty: "medium",
    },
    {
      prompt: "A stronger stimulus causes:",
      options: [
        "A bigger action potential",
        "A longer action potential",
        "A higher frequency of action potentials",
        "Slower conduction",
      ],
      correctOptionIdx: 2,
      explanation:
        "Because of the all-or-nothing principle, stimulus strength is coded by frequency, not by amplitude.",
      difficulty: "medium",
    },
    {
      prompt: "Which ion is responsible for repolarisation?",
      options: ["Sodium", "Potassium", "Calcium", "Chloride"],
      correctOptionIdx: 1,
      explanation: "After depolarisation, potassium leaves the cell and the membrane voltage falls again.",
      difficulty: "medium",
    },
    {
      prompt: "What triggers the release of neurotransmitter into the synaptic cleft?",
      options: [
        "Calcium entering the axon terminal",
        "Potassium leaving the dendrite",
        "Sodium channels closing",
        "The action of myelin",
      ],
      correctOptionIdx: 0,
      explanation:
        "The action potential opens calcium channels, and calcium triggers the vesicles to fuse with the membrane.",
      difficulty: "hard",
    },
    {
      prompt: "The parasympathetic nervous system mainly:",
      options: [
        "Prepares the body for fight or flight",
        "Speeds up the heart rate",
        "Calms the body and promotes digestion",
        "Controls voluntary movement",
      ],
      correctOptionIdx: 2,
      explanation: "The parasympathetic system dominates at rest and supports digestion and recovery.",
      difficulty: "easy",
    },
    {
      prompt: "A cluster of nerve cell bodies outside the central nervous system is called:",
      options: ["A nucleus", "A ganglion", "A synapse", "A sheath"],
      correctOptionIdx: 1,
      explanation: "Outside the central nervous system it is a ganglion; inside, it is a nucleus.",
      difficulty: "hard",
    },
  ],
  practice: [
    {
      prompt: "Describe the path of a signal from a dendrite to the next cell.",
      answerGuide:
        "Dendrites receive the signal, the cell body sums it, an action potential fires at the axon hillock once threshold is exceeded, and it travels along the axon to the axon terminals, where neurotransmitter is released into the synaptic cleft.",
      difficulty: "medium",
      expectedAnswer:
        "Dendrite → cell body → axon hillock → axon → axon terminal → synaptic cleft → receptors on the next cell.",
      strengths: "The sequence of structures is correct.",
      missingPoints: "Also mention the role of calcium in releasing the vesicles.",
    },
    {
      prompt: "Explain the all-or-nothing principle and say how the body codes the strength of a stimulus.",
      answerGuide:
        "An action potential either fires at full size or not at all. A stronger stimulus increases the firing frequency and the number of neurons excited, not the amplitude of the signal.",
      difficulty: "medium",
      expectedAnswer:
        "The amplitude is always the same; stimulus strength is coded by the frequency of action potentials and the number of fibres activated.",
      strengths: "You correctly state that the amplitude stays the same.",
      missingPoints: "Add the role of the threshold of excitation.",
    },
    {
      prompt: "Compare the sympathetic and parasympathetic nervous systems.",
      answerGuide:
        "The sympathetic system prepares the body for exertion: it speeds up the heart rate, widens the bronchi and slows digestion. The parasympathetic system does the opposite and dominates at rest. Their main neurotransmitters are noradrenaline and acetylcholine.",
      difficulty: "easy",
      expectedAnswer:
        "Sympathetic = activation (fight or flight, noradrenaline); parasympathetic = calming and digestion (acetylcholine).",
      strengths: "The opposing effects are presented clearly.",
      missingPoints: "Name at least one specific organ and the effect on it.",
    },
    {
      prompt: "Why is the refractory period important for the nervous system to work properly?",
      answerGuide:
        "During the refractory period the neuron cannot be excited, so the action potential cannot travel back along the axon. This ensures one-way conduction and limits the maximum firing frequency.",
      difficulty: "hard",
      expectedAnswer:
        "It ensures the signal spreads in one direction only and limits the frequency of action potentials.",
      strengths: "You recognise the protective role of the refractory period.",
      missingPoints: "Distinguish between the absolute and the relative refractory period.",
    },
  ],
  transcript: [],
  chatAnswers: [
    "The myelin sheath acts as an insulator, so depolarisation happens only at the nodes of Ranvier. The signal literally jumps from node to node, which is called saltatory conduction and is much faster than continuous conduction.",
    "The all-or-nothing principle means an action potential either occurs at full size or not at all. That is why a stronger stimulus does not increase the amplitude, but the firing frequency and the number of fibres activated.",
    "A ganglion and a nucleus are both clusters of nerve cell bodies – the only difference is where they sit. A ganglion lies outside the central nervous system and a nucleus inside it. This comes up in exams a lot.",
    "Transmission across a synapse works like this: the action potential reaches the axon terminal, calcium channels open, calcium triggers the vesicles to fuse with the membrane, and the neurotransmitter is released into the cleft, where it binds to receptors on the next cell.",
  ],
};

const ERP_CLANEK: DemoNotePack = {
  key: "erp",
  title: "Article: ERP systems in practice",
  sourceType: "link",
  durationSeconds: null,
  summary:
    "The article explains what an ERP system is, which modules companies roll out first, why implementations so often go over budget, and which indicators show whether the investment has paid off.",
  keyTopics: [
    "What an ERP system is",
    "Key modules",
    "The implementation process",
    "The most common reasons for failure",
    "Measuring the return",
  ],
  notesMd: `## Quick Overview

ERP is a single information system that links the business processes of different departments through one shared database. Instead of separate programs for finance, purchasing and production, everyone works with the same data in real time. The biggest challenge of an implementation is not the technology but changing how people work.

> **Key takeaway:** An ERP system does not create value when it is installed, but when the company adapts its processes to the system rather than the other way round.

## Key Things To Know

- ERP stands for Enterprise Resource Planning.
- The system is built on a single database shared by every module.
- The finance and purchasing modules are usually the first to be rolled out.
- Customising the standard package is the main cause of cost overruns.
- Whether an implementation succeeds depends more on management support and training than on the choice of vendor.

| Module | What it covers | Typical benefit |
| --- | --- | --- |
| Finance | General ledger, receivables, payables | Faster period-end close |
| Purchasing | Orders, suppliers, stock | Lower stock levels and better terms |
| Production | Work orders, bills of materials | Shorter lead times |
| HR | Records, payroll, absences | Less manual work |

## 1. 🏢 What Is an ERP System

### Core Idea

ERP is an integrated software solution that ties a company's business processes together around a single shared database.

### Detailed Notes

Before ERP, departments used separate programs and passed data between them by hand or through reports. This led to discrepancies between departments. ERP removes them, because every transaction is recorded once and is immediately visible to everyone.

- **Definition:** A module is a self-contained part of the system that covers one specific area of the business.
- The system is only as good as the quality of the data entered into it.
- Modern solutions are increasingly cloud-based, which lowers the cost of getting started.

## 2. 🧩 Phased Implementation

### Core Idea

Implementation happens in phases, because switching every department over at once greatly increases the risk.

### Detailed Notes

Companies usually start with the finance module, because that is where processes are most standardised. Purchasing and sales follow, and only then production, which is the most industry-specific.

### Process

- Analyse the existing processes and list the requirements.
- Choose a vendor and define the scope of the project.
- Configure the system, migrate the data and test.
- Train the users and go live.
- Stabilise, then add further modules step by step.

## 3. ⚠️ Why Implementations Fail

### Core Idea

Most failed projects fail for organisational rather than technical reasons.

### Detailed Notes

The most common causes are an unclear project scope, over-customising the standard package, poor quality of the migrated data and too little training. Every customisation also raises the cost of every future upgrade.

> **Common mistake:** The company carries an old, inefficient process over into the new system and then finds that nothing has improved.

## 4. 📊 Measuring the Return

### Core Idea

The return is measured with business indicators before and after implementation, not by how users feel about it.

### Detailed Notes

The indicators most often tracked are the time taken to close the month, stock turnover, the share of late deliveries and the number of manual corrections. The real effect usually only shows after a few months of stabilisation.

### Check Yourself

- What is the main advantage of a shared database?
- Why does an implementation usually start with the finance module?
- What are the three most common reasons for failure?
- How do we measure whether the investment has paid off?

## Final Review

- ERP links departments around a single database.
- Implementation should be phased, starting with the most standardised processes.
- Over-customisation is the main cause of budget overruns.
- Data quality and training decide whether it succeeds.
- The return is proven by measurable indicators taken before and after implementation.`,
  images: [
    {
      file: "en/erp-moduli.svg",
      fileName: "erp-modules.png",
      alt: "ERP system modules around a shared database",
      afterText: "Before ERP, departments used separate programs",
    },
    {
      file: "en/erp-uvedba.svg",
      fileName: "implementation-phases.png",
      alt: "The phases of an ERP implementation",
      afterText: "Companies usually start with the finance module",
    },
  ],
  sections: [
    { title: "What is an ERP system", sourceLabel: "Article, part 1" },
    { title: "Phased implementation", sourceLabel: "Article, part 2" },
    { title: "Reasons for failure", sourceLabel: "Article, part 3" },
    { title: "Measuring the return", sourceLabel: "Article, part 4" },
  ],
  flashcards: [
    {
      front: "What does the abbreviation ERP stand for?",
      back: "Enterprise Resource Planning – planning a company's resources.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "What is the main technical advantage of an ERP system?",
      back: "A single shared database, so every piece of data is entered once and is immediately visible to every department.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "What is a module in an ERP system?",
      back: "A self-contained part of the system that covers one business area, such as finance or purchasing.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "Which module does an implementation usually start with, and why?",
      back: "Finance, because financial processes are the most standardised and the least dependent on the industry.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "List the phases of an ERP implementation.",
      back: "Process analysis, vendor selection, configuration and data migration, testing, training, go-live and stabilisation.",
      difficulty: "hard",
      sectionIdx: 1,
    },
    {
      front: "Why is over-customising the system dangerous?",
      back: "It raises the cost of the project and makes every future upgrade more expensive, because the customisations have to be checked again each time.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "What are the most common reasons an implementation fails?",
      back: "An unclear project scope, over-customisation, poor data quality and too little user training.",
      difficulty: "medium",
      sectionIdx: 2,
    },
    {
      front: "Which indicators do we use to measure the return on an ERP system?",
      back: "The time taken to close the month, stock turnover, the share of late deliveries and the number of manual corrections.",
      difficulty: "medium",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "What is the defining feature of an ERP system?",
      options: [
        "Each department has its own database",
        "All modules share one common database",
        "The system only works offline",
        "It is intended for accounting only",
      ],
      correctOptionIdx: 1,
      explanation:
        "The shared database is the essence of an ERP system and removes discrepancies between departments.",
      difficulty: "easy",
    },
    {
      prompt: "Which module do companies usually roll out first?",
      options: ["Production", "HR", "Finance", "Maintenance"],
      correctOptionIdx: 2,
      explanation:
        "Financial processes are the most standardised, so the risk of implementing them is the lowest.",
      difficulty: "medium",
    },
    {
      prompt: "What is the most common cause of going over budget?",
      options: [
        "Over-customising the standard package",
        "Too few users",
        "Using a cloud solution",
        "Starting production too quickly",
      ],
      correctOptionIdx: 0,
      explanation:
        "Every customisation makes the project – and every future upgrade of the system – more expensive.",
      difficulty: "medium",
    },
    {
      prompt: "Why is data quality crucial during migration?",
      options: [
        "Because the system does not work without data",
        "Because bad data in the new system leads to bad decisions",
        "Because migration needs more servers",
        "Because the data is deleted after migration",
      ],
      correctOptionIdx: 1,
      explanation:
        "A new system does not fix bad data; it just spreads it through the company faster.",
      difficulty: "hard",
    },
    {
      prompt: "Which indicator best shows the effect of ERP on stock?",
      options: [
        "The number of system users",
        "Stock turnover",
        "The number of modules",
        "The length of the training",
      ],
      correctOptionIdx: 1,
      explanation: "Stock turnover directly measures how efficiently the company manages its stock.",
      difficulty: "medium",
    },
    {
      prompt: "When do the real effects of an implementation usually show?",
      options: [
        "Immediately at go-live",
        "After a few months of stabilisation",
        "Only after switching vendor",
        "They can never be measured",
      ],
      correctOptionIdx: 1,
      explanation:
        "Go-live is followed by a period of stabilisation while users get used to the new processes.",
      difficulty: "easy",
    },
  ],
  practice: [
    {
      prompt: "Explain why a shared database is the main advantage of an ERP system.",
      answerGuide:
        "Data is entered once and is immediately available to every department, which removes duplication, manual transfers and discrepancies between different departments' reports.",
      difficulty: "easy",
      expectedAnswer:
        "One entry, one source of truth, no manual transfers between systems and no discrepancies between departments.",
      strengths: "You recognise that duplicate data is eliminated.",
      missingPoints: "Add a concrete example, such as a shared stock record.",
    },
    {
      prompt: "Describe the phases of an ERP implementation and explain why a phased approach is safer.",
      answerGuide:
        "Analysis, vendor selection, configuration and migration, testing, training, go-live and stabilisation. A phased approach limits the scope of the risk and allows the team to learn on a smaller part of the system.",
      difficulty: "medium",
      expectedAnswer:
        "The phases run from analysis to stabilisation; doing it gradually reduces the risk of every process failing at once.",
      strengths: "The phases are listed in the right order.",
      missingPoints: "Explain why the production module usually comes last.",
    },
    {
      prompt: "After a year, a company sees no benefit from its ERP system. What would you check first?",
      answerGuide:
        "Whether the processes stayed the same, whether training was sufficient, how good the migrated data is, and whether they are measuring the right indicators before and after implementation at all.",
      difficulty: "hard",
      expectedAnswer:
        "I would check whether processes changed, the training, the data quality and whether baseline measurements exist.",
      strengths: "You look for organisational causes, not just technical ones.",
      missingPoints: "Also mention how far the standard package was customised.",
    },
    {
      prompt: "How would you measure the return on an investment in an ERP system?",
      answerGuide:
        "By comparing measurable indicators before and after implementation: the time taken to close the month, stock turnover, the share of late deliveries and the volume of manual corrections, while taking the total cost of ownership into account.",
      difficulty: "medium",
      expectedAnswer:
        "I set baseline measurements, repeat them after stabilisation and compare the results with the total cost of the project.",
      strengths: "You stress taking a baseline measurement before implementation.",
      missingPoints: "Include maintenance and licence costs as well.",
    },
  ],
  transcript: [],
  chatAnswers: [
    "The main advantage is a single shared database. Data is entered once and is immediately visible to every department, so there are no manual transfers, no duplication and no discrepancies between the finance and purchasing reports.",
    "Companies start with the finance module because financial processes are the most standardised and the least dependent on the industry. The production module comes last because it is the most specific.",
    "The most common reasons for failure are organisational: an unclear project scope, over-customising the standard package, poor quality of the migrated data and too little user training.",
    "You measure the return by recording baseline indicators before implementation – the time taken to close the month, stock turnover, the share of late deliveries – and measuring them again after a few months of stabilisation.",
  ],
};

const ZGODOVINA: DemoNotePack = {
  key: "zgodovina",
  title: "History – the French Revolution",
  sourceType: "presentation",
  pageCount: 18,
  durationSeconds: null,
  summary:
    "The notes sum up the causes of the French Revolution, its course from the summoning of the Estates-General to Napoleon's seizure of power, and its long-term consequences for Europe.",
  keyTopics: [
    "Causes of the revolution",
    "The Estates-General and the National Assembly",
    "The Declaration of Rights",
    "The Jacobin dictatorship",
    "Consequences for Europe",
  ],
  notesMd: `## Quick Overview

The French Revolution began as a financial crisis of the absolute monarchy and grew into a fundamental break with the old social order. Within ten years, France went from a society of estates to a republic, and then to Napoleon's dictatorship. Even so, the idea of equality before the law spread across the whole of Europe.

> **Key takeaway:** The revolution did not break out because of a single injustice, but because state bankruptcy, a bad harvest and a system of estates that placed the tax burden on those with the fewest rights all came together.

## Key Things To Know

- French society was divided into three estates, and taxes were paid mainly by the Third Estate.
- The treasury had been drained by wars and the cost of the royal court.
- Summoning the Estates-General in 1789 sparked a political dispute over how votes would be cast.
- The Declaration of the Rights of Man and of the Citizen introduced equality before the law.
- The revolution ended with Napoleon's coup d'état in 1799.

| Period | Key event | Consequence |
| --- | --- | --- |
| 1789 | Estates-General summoned, storming of the Bastille | End of absolutism |
| 1791 | First constitution | Constitutional monarchy |
| 1793–1794 | Jacobin dictatorship | The Terror and mass executions |
| 1799 | Napoleon's coup d'état | End of the revolution |

## 1. 🔥 Causes

### Core Idea

The revolution was triggered by the state's financial collapse coinciding with deep social inequality.

### Detailed Notes

The first two estates, the clergy and the nobility, were largely exempt from taxes, even though they held the most wealth. The Third Estate made up more than ninety per cent of the population and bore almost the entire tax burden. The bad harvest of 1788 pushed the price of bread to a level that meant hunger for the urban population.

- **Definition:** A society of estates is an order in which rights are determined by birth rather than merit.
- Enlightenment ideas provided the language for criticising absolutism.
- Supporting the American Revolution finally emptied the treasury.

## 2. 🏛️ From the Estates-General to the Republic

### Core Idea

The dispute over voting led the Third Estate to proclaim itself the National Assembly.

### Detailed Notes

In May 1789 the king summoned the Estates-General to approve new taxes. Because each estate had one vote, the Third Estate would always be outvoted. In June it declared itself the National Assembly and, in the Tennis Court Oath, swore not to disband until France had a constitution.

### Process

- May 1789: the Estates-General meets at Versailles.
- June 1789: the National Assembly is proclaimed and the Tennis Court Oath is sworn.
- July 1789: the storming of the Bastille, the symbolic end of absolutism.
- August 1789: the Declaration of the Rights of Man and of the Citizen.
- September 1792: the republic is proclaimed.

## 3. ⚔️ The Jacobin Dictatorship

### Core Idea

War and internal revolts led to an emergency regime that removed its opponents through death sentences.

### Detailed Notes

The Committee of Public Safety under Robespierre introduced mass conscription, price controls and revolutionary tribunals. The Terror was presented as a temporary means of saving the republic, but it ended up consuming the revolutionaries themselves.

> **Common mistake:** The Terror was not the programme of the revolution as a whole, but a response to a particular period of war and internal crisis.

## 4. 🌍 Consequences

### Core Idea

The revolution abolished feudal privileges and spread the principle of equality before the law across Europe.

### Detailed Notes

Napoleon's campaigns carried his legal code and administrative reforms into the occupied territories. The old order was partly restored after 1815, but the idea of national sovereignty survived and set off new movements in the 19th century.

### Check Yourself

- Why was the tax system before the revolution unsustainable?
- What was the significance of the Tennis Court Oath?
- Which document introduced equality before the law?
- Why did the revolution end in a dictatorship?

## Final Review

- The causes were financial, social and intellectual all at once.
- The storming of the Bastille was the symbolic, not the actual, end of absolutism.
- The 1789 Declaration is the foundation of modern citizens' rights.
- The Terror was a response to a state of war, not the aim of the revolution.
- The revolution's legacy is the idea of equality before the law and national sovereignty.`,
  images: [
    {
      file: "en/revolucija-casovnica.svg",
      fileName: "timeline-1789-1799.png",
      alt: "Timeline of the French Revolution from 1789 to 1799",
      afterText: "In May 1789 the king summoned the Estates-General",
    },
  ],
  sections: [
    { title: "Causes of the revolution", sourceLabel: "Unit 1" },
    { title: "From the estates to the republic", sourceLabel: "Unit 2" },
    { title: "The Jacobin dictatorship", sourceLabel: "Unit 3" },
    { title: "Consequences", sourceLabel: "Unit 4" },
  ],
  flashcards: [
    {
      front: "How was French society divided before the revolution?",
      back: "Into three estates: the clergy, the nobility and the Third Estate, which made up more than 90 per cent of the population.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Why was the tax system unsustainable?",
      back: "The first two estates were largely exempt from taxes, so the burden fell on the Third Estate, which had the fewest rights.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "What was the Tennis Court Oath?",
      back: "The pledge made by the deputies of the National Assembly in 1789 not to disband until France had a constitution.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "What does the storming of the Bastille symbolise?",
      back: "The symbolic fall of absolute rule and the start of the revolution; 14 July is still a national holiday today.",
      difficulty: "easy",
      sectionIdx: 1,
    },
    {
      front: "What did the Declaration of the Rights of Man and of the Citizen introduce?",
      back: "Equality before the law, freedom of speech and religion, and the principle that power comes from the nation.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Who led the Committee of Public Safety?",
      back: "Maximilien Robespierre, during the Jacobin dictatorship of 1793–1794.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Why did the Terror happen?",
      back: "Because of foreign war and internal revolts, the regime introduced emergency measures and revolutionary tribunals.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "When and how did the revolution end?",
      back: "In 1799, with Napoleon's coup d'état, which turned the republic into personal rule.",
      difficulty: "medium",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "Which estate bore the heaviest tax burden?",
      options: ["The clergy", "The nobility", "The Third Estate", "All of them equally"],
      correctOptionIdx: 2,
      explanation:
        "The first two estates were largely exempt from taxes, so the burden fell on the Third Estate.",
      difficulty: "easy",
    },
    {
      prompt: "What was the immediate reason for summoning the Estates-General?",
      options: [
        "Victory in a war",
        "The state's financial crisis",
        "The death of the king",
        "The discovery of new territories",
      ],
      correctOptionIdx: 1,
      explanation: "The king needed new taxes approved because the treasury was empty.",
      difficulty: "medium",
    },
    {
      prompt: "Which event is seen as the symbolic start of the revolution?",
      options: [
        "The Tennis Court Oath",
        "The storming of the Bastille",
        "The proclamation of the republic",
        "Napoleon's coup",
      ],
      correctOptionIdx: 1,
      explanation: "The storming of the Bastille on 14 July 1789 is the symbolic fall of absolutism.",
      difficulty: "easy",
    },
    {
      prompt: "What did the Declaration of the Rights of Man and of the Citizen establish?",
      options: [
        "The return of feudal privileges",
        "Equality before the law and national sovereignty",
        "Compulsory military service",
        "The abolition of private property",
      ],
      correctOptionIdx: 1,
      explanation:
        "The Declaration introduced equality before the law and the principle that power comes from the nation.",
      difficulty: "medium",
    },
    {
      prompt: "The Jacobin dictatorship was above all a response to:",
      options: [
        "Economic growth",
        "Foreign war and internal revolts",
        "The king's return to the throne",
        "The founding of colonies",
      ],
      correctOptionIdx: 1,
      explanation: "The emergency measures were justified by the state of war and internal revolts.",
      difficulty: "hard",
    },
    {
      prompt: "What is the most lasting legacy of the revolution?",
      options: [
        "The restoration of the society of estates",
        "The idea of equality before the law and national sovereignty",
        "The abolition of the army",
        "The return of absolutism",
      ],
      correctOptionIdx: 1,
      explanation:
        "Despite the restoration after 1815, the ideas of equality and national sovereignty survived.",
      difficulty: "medium",
    },
  ],
  practice: [
    {
      prompt: "List and explain three main causes of the French Revolution.",
      answerGuide:
        "The state's financial collapse caused by wars and the cost of the court, the social inequality of a society of estates with tax privileges, and Enlightenment ideas that provided the language for criticising absolutism. The bad harvest of 1788 acted as the trigger.",
      difficulty: "medium",
      expectedAnswer:
        "Financial crisis, inequality between the estates and Enlightenment ideas, with the high price of bread as the trigger.",
      strengths: "You separate the long-term causes from the immediate trigger.",
      missingPoints: "Add the role of supporting the American Revolution in emptying the treasury.",
    },
    {
      prompt: "Explain why the dispute over voting in the Estates-General led to a break.",
      answerGuide:
        "Voting was by estate, so the Third Estate would always be outvoted two to one, even though it represented the vast majority of the population. Its demand for voting by head was rejected, so the Third Estate declared itself the National Assembly.",
      difficulty: "hard",
      expectedAnswer:
        "Voting by estate always left the Third Estate in the minority, so it broke away and formed the National Assembly.",
      strengths: "You identify how the outvoting worked.",
      missingPoints: "Mention the Tennis Court Oath as the point of no return.",
    },
    {
      prompt: "Why did a revolution that began with a demand for freedom end in a dictatorship?",
      answerGuide:
        "War, internal revolts and economic crisis led to emergency measures and the Terror. After Robespierre's fall came political instability, which Napoleon exploited with the army's backing.",
      difficulty: "hard",
      expectedAnswer:
        "Because of the state of war, the Terror and the later instability of the Directory, which the army exploited.",
      strengths: "You link the external threat to radicalisation at home.",
      missingPoints: "Add the army's role as the guarantor of order after 1795.",
    },
    {
      prompt: "What were the consequences of the revolution for the rest of Europe?",
      answerGuide:
        "Napoleon's campaigns spread the civil code and administrative reforms, abolished what remained of feudalism and encouraged national movements. After 1815 the old order was partly restored, but the ideas lived on.",
      difficulty: "medium",
      expectedAnswer:
        "The spread of the civil code and equality before the law, the abolition of feudal remnants and the rise of national movements.",
      strengths: "You recognise how ideas spread through military campaigns.",
      missingPoints: "Mention the Congress of Vienna and the attempt at restoration.",
    },
  ],
  transcript: [],
  chatAnswers: [
    "There were three main causes, and they worked together: state bankruptcy after expensive wars, a society of estates that gave the first two estates tax privileges, and Enlightenment ideas that provided the language for criticising absolutism. The high price of bread in 1788 was the trigger.",
    "In the Estates-General each estate had one vote, so the Third Estate would always be outvoted two to one – even though it represented more than 90 per cent of the population. That is why, in June 1789, it declared itself the National Assembly.",
    "The Terror was a response to an emergency: France was at war with a coalition of European monarchies and facing revolts at home. The Committee of Public Safety justified its emergency measures as necessary to save the republic.",
    "The Declaration of the Rights of Man and of the Citizen of August 1789 introduced equality before the law, freedom of speech and religion, and the principle that power comes from the nation and not from the king.",
  ],
};

export const EN_DEMO_CONTENT: DemoLocaleContent = {
  packs: [MIKROEKONOMIJA, ANATOMIJA, ERP_CLANEK, ZGODOVINA],
  folderNames: {
    "demo-folder-izpiti": "Exam period",
    "demo-folder-seminarska": "Term paper",
  },
  liveFigures: [
    {
      file: "en/ponudba-povprasevanje.svg",
      fileName: "equilibrium-graph.png",
      alt: "Supply and demand graph with the equilibrium point",
      anchor: "When any factor other than price changes",
    },
    {
      file: "en/elasticnost.svg",
      fileName: "elasticity-comparison.png",
      alt: "Elastic and inelastic demand compared",
      anchor: "Elasticity measures how sensitive quantity is to a change in price",
    },
    {
      file: "en/premik-krivulje.svg",
      fileName: "demand-shift.png",
      alt: "The demand curve shifting to the right and the new equilibrium",
      anchor: "The demand curve slopes downwards because each additional unit",
    },
    {
      file: "en/substituti-komplementi.svg",
      fileName: "substitutes-and-complements.png",
      alt: "Substitutes replace each other; complements are used together",
      anchor: "goods that can replace each other",
    },
    {
      file: "en/premik-ponudbe.svg",
      fileName: "supply-shift.png",
      alt: "The supply curve shifting to the right because of lower costs",
      anchor: "Labour and raw-material costs shift the supply curve",
    },
    {
      file: "en/presezek-primanjkljaj.svg",
      fileName: "surplus-and-shortage.png",
      alt: "A surplus above the equilibrium price and a shortage below it",
      anchor: "If the price is too high, goods go unsold",
    },
    {
      file: "en/prihodek-elasticnost.svg",
      fileName: "revenue-and-elasticity.png",
      alt: "Total revenue is highest where elasticity equals 1",
      anchor: "When the absolute value of the result is greater than 1",
    },
  ],
  liveHighlights: [
    { phrase: "This point is the market equilibrium", color: "green" },
    { phrase: "Price does not shift the curve", color: "purple" },
    { phrase: "Quantity demanded is the amount at a single price", color: "green" },
    {
      phrase: "Equilibrium is the only price with neither a surplus nor a shortage",
      color: "green",
    },
    { phrase: "Only a change in price causes a movement along the curve", color: "purple" },
    { phrase: "few substitutes, a short time frame, necessities", color: "green" },
    { phrase: "revenue is at its highest where elasticity equals 1", color: "purple" },
    {
      phrase:
        "The most common exam mistake is confusing a shift of the curve with a movement along the curve",
      color: "purple",
    },
  ],
  podcastTurns: [
    { speaker: "a", text: "Right, let's look at this note – what's the thing you really need to remember?" },
    { speaker: "b", text: "The framework first: without it, the individual facts are just a list." },
    { speaker: "a", text: "So you understand what it's for first, and only then the details." },
    { speaker: "b", text: "Exactly. And once that clicks, the details almost stick by themselves." },
    { speaker: "a", text: "Good. Let's take it step by step and check where people get stuck most often." },
    { speaker: "b", text: "Sure. And at the end we'll sum it up in one sentence, so it stays with you for the exam." },
  ],
};
