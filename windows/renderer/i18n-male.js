// i18n-male.js — the texts that speak of the fly as "she", as they read for a
// male fly (the single-specimen MaleCNS model): English source text ->
// [English, German]. t() uses them while setSubject('male') is active.
// tools/check-i18n.mjs --strict requires an entry for every translated text
// that says she/her (except texts that only describe a female fly).

export const MALE = {
  "The fly in the middle is driven by a real brain wiring diagram: every movement comes from simulated neurons connected exactly as in the {source} connectome. On the right you see the same brain in 3D, firing. Below it, the explanation panel tells you why she did what she just did.": [
    "The fly in the middle is driven by a real brain wiring diagram: every movement comes from simulated neurons connected exactly as in the {source} connectome. On the right you see the same brain in 3D, firing. Below it, the explanation panel tells you why he did what he just did.",
    "Die Fliege in der Mitte, ein Männchen, wird von einem echten Schaltplan seines Gehirns gesteuert: Jede Bewegung entsteht aus simulierten Neuronen, die genau so verbunden sind wie im {source}-Konnektom. Rechts siehst du dasselbe Gehirn in 3D, wie es feuert. Darunter erklärt dir das Warum-Feld, weshalb er gerade getan hat, was er getan hat."],
  "touch her; drag and release to flick her away": ["touch him; drag and release to flick him away", "berühren; ziehen und loslassen, um ihn wegzuschnippen"],
  "Move the cursor fast at her": ["Move the cursor fast at him", "Mauszeiger schnell auf ihn zu bewegen"],
  "Temperature where she stands": ["Temperature where he stands", "Temperatur an seinem Standort"],
  "No external trigger — her own network activity": ["No external trigger — his own network activity", "Kein äusserer Auslöser — seine eigene Netzwerkaktivität"],
  "Took off on her own": ["Took off on his own", "Aus eigenem Antrieb abgeflogen"],
  "Extended her proboscis": ["Extended his proboscis", "Rüssel ausgefahren"],
  "Something loomed on her left": ["Something loomed on his left", "Links näherte sich etwas"],
  "Something loomed on her right": ["Something loomed on his right", "Rechts näherte sich etwas"],
  "Sugar at her mouthparts": ["Sugar at his mouthparts", "Zucker an seinen Mundwerkzeugen"],
  "Bitter at her mouthparts": ["Bitter at his mouthparts", "Bitterstoff an seinen Mundwerkzeugen"],
  "Dust on her antennae": ["Dust on his antennae", "Staub auf seinen Fühlern"],
  "You stimulated her neurons": ["You stimulated his neurons", "Du hast seine Neuronen stimuliert"],
  "motion in her own eye": ["motion in his own eye", "Bewegung im eigenen Auge"],
  "Why did she do that?": ["Why did he do that?", "Warum hat er das getan?"],
  "Her survival budget reached zero. Her network receives no input from here on.": [
    "His survival budget reached zero. His network receives no input from here on.",
    "Sein Überlebensbudget ist bei null. Sein Netzwerk erhält ab jetzt keinen Input mehr."],
  "No change in her surroundings preceded it: the command neurons crossed threshold from her own ongoing network activity.": [
    "No change in his surroundings preceded it: the command neurons crossed threshold from his own ongoing network activity.",
    "Keine Veränderung in seiner Umgebung ging voraus: Die Kommandoneuronen überschritten die Schwelle aus seiner eigenen laufenden Netzwerkaktivität."],
  "No input reached the deciding neurons directly: they crossed threshold through her central network.": [
    "No input reached the deciding neurons directly: they crossed threshold through his central network.",
    "Kein Reiz erreichte die entscheidenden Neuronen direkt: Sie überschritten die Schwelle über sein zentrales Netzwerk."],
  "Her looming detectors fired at {hz} Hz, but the giant fiber stayed silent.": [
    "His looming detectors fired at {hz} Hz, but the giant fiber stayed silent.",
    "Seine Annäherungsdetektoren feuerten mit {hz} Hz, doch die Riesenfaser blieb still."],
  "Every time she does something — takes off, grooms, backs up, extends her proboscis — the causal chain appears here: the trigger, the sensory neurons, the synaptic input to the neurons that decided, and the rule that made it movement.": [
    "Every time he does something — takes off, grooms, backs up, extends his proboscis — the causal chain appears here: the trigger, the sensory neurons, the synaptic input to the neurons that decided, and the rule that made it movement.",
    "Jedes Mal, wenn er etwas tut — abfliegt, sich putzt, zurückweicht, den Rüssel ausfährt — erscheint hier die Ursachenkette: der Auslöser, die Sinnesneuronen, der synaptische Input der entscheidenden Neuronen und die Regel, die daraus Bewegung machte."],
  "Try: move the cursor quickly at her, or press L.": ["Try: move the cursor quickly at him, or press L.", "Probier es: Zeiger schnell auf ihn zu bewegen oder L drücken."],
  "Try: swipe quickly at her, or send a looming shadow under Stimulate.": ["Try: swipe quickly at him, or send a looming shadow under Stimulate.", "Probier es: schnell auf ihn zu wischen oder unter Reizen einen nahenden Schatten schicken."],
  "More DNa01/02 activity on the left than on the right turns her to the left.": [
    "More DNa01/02 activity on the left than on the right turns him to the left.",
    "Mehr DNa01/02-Aktivität links als rechts dreht ihn nach links."],
  "More DNa01/02 activity on the right than on the left turns her to the right.": [
    "More DNa01/02 activity on the right than on the left turns him to the right.",
    "Mehr DNa01/02-Aktivität rechts als links dreht ihn nach rechts."],
  "Proboscis extended onto a food drop: she stays and feeds while the motor neurons keep it extended.": [
    "Proboscis extended onto a food drop: he stays and feeds while the motor neurons keep it extended.",
    "Rüssel auf einem Futtertropfen: Er bleibt und frisst, solange die Motoneuronen ihn ausgefahren halten."],
  "High LC4/LPLC2 population rate without a giant-fiber spike: a body rule makes her dart away on foot.": [
    "High LC4/LPLC2 population rate without a giant-fiber spike: a body rule makes him dart away on foot.",
    "Hohe LC4/LPLC2-Rate ohne Riesenfaser-Spike: Eine Körperregel lässt ihn zu Fuss davonflitzen."],
  "A fly, running on her connectome.": ["A fly, running on his connectome.", "Eine Fliege, gesteuert von seinem Konnektom."],
  "{n} real FlyWire neurons and {m} nerve-cord neurons decide what she does — 120 times a second, on a CPU core of their own.": [
    "{n} real FlyWire neurons and {m} nerve-cord neurons decide what he does — 120 times a second, on a CPU core of their own.",
    "{n} echte FlyWire-Neuronen und {m} Neuronen des Bauchmarks entscheiden, was er tut — 120-mal pro Sekunde, auf einem eigenen Prozessorkern."],
  "An object rushes at her eyes": ["An object rushes at his eyes", "Ein Objekt rast auf seine Augen zu"],
  "A sudden gust at her antennae": ["A sudden gust at his antennae", "Ein plötzlicher Stoss an seine Fühler"],
  "Dust her antennae": ["Dust his antennae", "Fühler einstauben"],
  "Watch her clean her head": ["Watch him clean his head", "Sieh zu, wie er seinen Kopf putzt"],
  "Sugar on her mouthparts": ["Sugar on his mouthparts", "Zucker an seine Mundwerkzeuge"],
  "Bitter on her mouthparts": ["Bitter on his mouthparts", "Bitterstoff an seine Mundwerkzeuge"],
  "A drop in front of her": ["A drop in front of him", "Ein Tropfen vor ihm"],
  "Will she still eat?": ["Will he still eat?", "Frisst er trotzdem?"],
  "Camera exposure only. Her own eye always renders at the fixed physical exposure.": [
    "Camera exposure only. His own eye always renders at the fixed physical exposure.",
    "Nur die Kamerabelichtung. Sein eigenes Auge sieht immer mit der festen physikalischen Belichtung."],
  "Where she spends her time, and what her neurons did there. Drawn on a layer her own eye cannot see.": [
    "Where he spends his time, and what his neurons did there. Drawn on a layer his own eye cannot see.",
    "Wo er sich aufhält und was seine Neuronen dort taten. Auf einer Ebene gezeichnet, die sein eigenes Auge nicht sieht."],
  "Temperature she met": ["Temperature he met", "Erlebte Temperatur"],
  "{pct}% of her time in the half with the lower values": ["{pct}% of his time in the half with the lower values", "{pct} % seiner Zeit in der Hälfte mit den tieferen Werten"],
  "Every sense, the world, her body.": ["Every sense, the world, his body.", "Jeder Sinn, die Welt, sein Körper."],
  "These controls change what she experiences. Each one reaches the neurons that really transduce it.": [
    "These controls change what he experiences. Each one reaches the neurons that really transduce it.",
    "Diese Regler verändern, was er erlebt. Jeder erreicht genau die Neuronen, die den Reiz wirklich aufnehmen."],
  "Drives the {n} real LC4/LPLC2 looming neurons of one or both eyes for 300 ms. Her rendered eye also feeds them continuously: move the cursor at her, or drag an object towards her face.": [
    "Drives the {n} real LC4/LPLC2 looming neurons of one or both eyes for 300 ms. His rendered eye also feeds them continuously: move the cursor at him, or drag an object towards his face.",
    "Reizt die {n} echten LC4/LPLC2-Annäherungsneuronen eines oder beider Augen für 300 ms. Sein gerendertes Auge speist sie zusätzlich laufend: Zeiger auf ihn zu bewegen oder ein Objekt vor sein Gesicht ziehen."],
  "Drives the {n} real LC4/LPLC2 looming neurons of one or both eyes for 300 ms. Her rendered eye also feeds them continuously: swipe at her, or drag an object towards her face.": [
    "Drives the {n} real LC4/LPLC2 looming neurons of one or both eyes for 300 ms. His rendered eye also feeds them continuously: swipe at him, or drag an object towards his face.",
    "Reizt die {n} echten LC4/LPLC2-Annäherungsneuronen eines oder beider Augen für 300 ms. Sein gerendertes Auge speist sie zusätzlich laufend: auf ihn zu wischen oder ein Objekt vor sein Gesicht ziehen."],
  "Pushes her body and deflects the arista: drives JO-C/D/E wind neurons, not the hearing neurons.": [
    "Pushes his body and deflects the arista: drives JO-C/D/E wind neurons, not the hearing neurons.",
    "Schiebt seinen Körper und lenkt die Arista aus: reizt die JO-C/D/E-Windneuronen, nicht die Hörneuronen."],
  "Reaches the real hot and cold cells; below 10 °C cold torpor slows her nervous system.": [
    "Reaches the real hot and cold cells; below 10 °C cold torpor slows his nervous system.",
    "Erreicht die echten Wärme- und Kältezellen; unter 10 °C bremst Kältestarre sein Nervensystem."],
  "Offer to her mouthparts": ["Offer to his mouthparts", "An die Mundwerkzeuge geben"],
  "Wets her wings; droplets tap her antennae.": ["Wets his wings; droplets tap his antennae.", "Macht seine Flügel nass; Tropfen tippen an seine Fühler."],
  "Local heat to her thermosensors plus a bright looming object. Drag it.": [
    "Local heat to his thermosensors plus a bright looming object. Drag it.",
    "Lokale Hitze für seine Thermosensoren plus ein helles, nahendes Objekt. Verschiebbar."],
  "Dust settles on her antennae — the grooming circuit is for exactly this.": [
    "Dust settles on his antennae — the grooming circuit is for exactly this.",
    "Staub legt sich auf seine Fühler — genau dafür gibt es den Putzschaltkreis."],
  "Above 2.5× she cannot fly; the load her leg sensors report rises.": [
    "Above 2.5× he cannot fly; the load his leg sensors report rises.",
    "Über 2,5× kann er nicht fliegen; die von seinen Beinsensoren gemeldete Last steigt."],
  "Scales the neural baseline drive; below 10% her network falls almost silent.": [
    "Scales the neural baseline drive; below 10% his network falls almost silent.",
    "Skaliert den neuronalen Grundantrieb; unter 10 % verstummt sein Netzwerk fast."],
  "Her eye": ["His eye", "Sein Auge"],
  "What she sees — a real render from her head, 64 × 24 samples, 150°": [
    "What he sees — a real render from his head, 64 × 24 samples, 150°",
    "Was er sieht — ein echtes Rendering aus seinem Kopf, 64 × 24 Bildpunkte, 150°"],
  "Left half: her left eye. Only what lights up on the right drives the looming neurons: broad self-motion is cancelled by the centre-surround stage, and an efference copy of her own movement is subtracted as well (model).": [
    "Left half: his left eye. Only what lights up on the right drives the looming neurons: broad self-motion is cancelled by the centre-surround stage, and an efference copy of his own movement is subtracted as well (model).",
    "Linke Hälfte: sein linkes Auge. Nur was rechts aufleuchtet, treibt die Looming-Neuronen: Breite Eigenbewegung hebt die Zentrum-Umfeld-Stufe auf, und zusätzlich wird eine Efferenzkopie seiner eigenen Bewegung abgezogen (Modell)."],
  "How strong must an approaching object be before the giant fiber fires and she takes off?": [
    "How strong must an approaching object be before the giant fiber fires and he takes off?",
    "Wie stark muss ein nahendes Objekt sein, bis die Riesenfaser feuert und er abhebt?"],
  "Two stimuli of equal strength reach different Johnston's-organ neurons. Does the wiring alone decide which one makes her flee?": [
    "Two stimuli of equal strength reach different Johnston's-organ neurons. Does the wiring alone decide which one makes him flee?",
    "Zwei gleich starke Reize erreichen verschiedene Neuronen des Johnstonschen Organs. Entscheidet allein die Verschaltung, welcher ihn flüchten lässt?"],
  "Does more sugar make her extend her proboscis more reliably — and can bitter talk her out of it?": [
    "Does more sugar make him extend his proboscis more reliably — and can bitter talk him out of it?",
    "Fährt er mit mehr Zucker den Rüssel zuverlässiger aus — und kann Bitterstoff ihn davon abbringen?"],
  "Does dust on the antennae make her groom her head — and does it need the JO-F sensory neurons to do it?": [
    "Does dust on the antennae make him groom his head — and does it need the JO-F sensory neurons to do it?",
    "Lässt Staub auf den Fühlern ihn den Kopf putzen — und braucht er dafür die JO-F-Sinnesneuronen?"],
  "Put her in an arena that runs from 18 °C to 32 °C. Does she end up where it is comfortable, as real flies do?": [
    "Put him in an arena that runs from 18 °C to 32 °C. Does he end up where it is comfortable, as real flies do?",
    "Setze ihn in eine Arena von 18 °C bis 32 °C. Landet er dort, wo es angenehm ist, wie echte Fliegen?"],
  "Below a looming intensity of about {x50} she stays; above it the giant fiber fires within milliseconds and she takes off — a threshold, as in real flies.": [
    "Below a looming intensity of about {x50} he stays; above it the giant fiber fires within milliseconds and he takes off — a threshold, as in real flies.",
    "Unter einer Annäherungsstärke von etwa {x50} bleibt er; darüber feuert die Riesenfaser innert Millisekunden und er hebt ab — eine Schwelle, wie bei echten Fliegen."],
  "Dust makes her groom her head, and silencing the JO-F neurons abolishes it: the behaviour needs exactly the sensory cells the literature identifies.": [
    "Dust makes him groom his head, and silencing the JO-F neurons abolishes it: the behaviour needs exactly the sensory cells the literature identifies.",
    "Staub lässt ihn seinen Kopf putzen, und das Stilllegen der JO-F-Neuronen hebt es auf: Das Verhalten braucht genau die Sinneszellen, die die Literatur benennt."],
  "She groomed, but silencing JO-F did not abolish it significantly.": [
    "He groomed, but silencing JO-F did not abolish it significantly.",
    "Er putzte sich, doch das Stilllegen von JO-F hob es nicht signifikant auf."],
  "Weaker inhibitory synapses let the looming signal recruit the giant fiber more strongly; stronger inhibition holds it back — and near threshold it decides whether she escapes.": [
    "Weaker inhibitory synapses let the looming signal recruit the giant fiber more strongly; stronger inhibition holds it back — and near threshold it decides whether he escapes.",
    "Schwächere hemmende Synapsen lassen das Annäherungssignal die Riesenfaser stärker rekrutieren; stärkere Hemmung hält sie zurück — und nahe der Schwelle entscheidet das, ob er flieht."],
  "She finds the comfortable zone": ["He finds the comfortable zone", "Er findet die angenehme Zone"],
  "In the gradient she spent more time near 25 °C than in the flat control.": [
    "In the gradient he spent more time near 25 °C than in the flat control.",
    "Im Gefälle verbrachte er mehr Zeit nahe 25 °C als in der gleichmässigen Kontrolle."],
  "She did not spend more time near 25 °C in the gradient than in the flat control. Real flies do. Her antennal hot and cold cells respond, but in the extracted circuit their signal does not measurably reach the neurons that steer or start walking, and the brain's internal warmth sensors (AC neurons) are missing.": [
    "He did not spend more time near 25 °C in the gradient than in the flat control. Real flies do. His antennal hot and cold cells respond, but in the extracted circuit their signal does not measurably reach the neurons that steer or start walking, and the brain's internal warmth sensors (AC neurons) are missing.",
    "Im Gefälle verbrachte er nicht mehr Zeit nahe 25 °C als in der gleichmässigen Kontrolle. Echte Fliegen tun das. Seine Wärme- und Kältezellen der Antennen reagieren, doch im extrahierten Schaltkreis erreicht ihr Signal die Neuronen, die lenken oder das Gehen auslösen, nicht messbar, und die inneren Wärmesensoren des Gehirns (AC-Neuronen) fehlen."],
  "Does she feel anything?": ["Does he feel anything?", "Empfindet er etwas?"],
  "No injury state in the nervous system and no analgesic she could seek.": [
    "No injury state in the nervous system and no analgesic he could seek.",
    "Kein Verletzungszustand im Nervensystem und kein Schmerzmittel, das er suchen könnte."],
  "early vision: motion energy in her rendered eye after a centre-surround stage, minus an efference copy of her own expected self-motion (Kim, Fitzgerald & Maimon 2015), drives the looming neurons": [
    "early vision: motion energy in his rendered eye after a centre-surround stage, minus an efference copy of his own expected self-motion (Kim, Fitzgerald & Maimon 2015), drives the looming neurons",
    "frühes Sehen: Die Bewegungsenergie in seinem gerenderten Auge treibt nach einer Zentrum-Umfeld-Stufe und abzüglich einer Efferenzkopie seiner eigenen erwarteten Bewegung (Kim, Fitzgerald & Maimon 2015) die Looming-Neuronen"],
  "View only: changes how you see the fly, never what she experiences.": [
    "View only: changes how you see the fly, never what he experiences.",
    "Nur Ansicht: verändert, wie du die Fliege siehst, nie, was er erlebt."],
  "Drag the fly · swipe at her to startle · two fingers turn and zoom": [
    "Drag the fly · swipe at him to startle · two fingers turn and zoom",
    "Fliege ziehen · auf ihn zu wischen erschreckt ihn · zwei Finger drehen und zoomen"],
  "The fly is driven by a real brain wiring diagram: every movement comes from simulated neurons connected exactly as in the {source} connectome. Brain shows the same brain in 3D, firing; Why tells you why she did what she just did.": [
    "The fly is driven by a real brain wiring diagram: every movement comes from simulated neurons connected exactly as in the {source} connectome. Brain shows the same brain in 3D, firing; Why tells you why he did what he just did.",
    "Die Fliege, ein Männchen, wird von einem echten Schaltplan seines Gehirns gesteuert: Jede Bewegung entsteht aus simulierten Neuronen, die genau so verbunden sind wie im {source}-Konnektom. «Gehirn» zeigt dasselbe Gehirn in 3D, wie es feuert; «Warum» erklärt, weshalb er gerade getan hat, was er getan hat."],
  "drag and release to flick her away": [
    "drag and release to flick him away",
    "ziehen und loslassen, um ihn wegzuschnippen"],
  "Swipe fast at her": [
    "Swipe fast at him",
    "Schnell auf ihn zu wischen"],
};
